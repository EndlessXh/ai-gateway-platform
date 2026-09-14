<#
.SYNOPSIS
    Runs low-cost Phase 6A OpenRouter checks through the local HYC AI API.

.DESCRIPTION
    Creates a short-lived, model-limited provider-spike token, exercises the
    public alias, records only sanitized assertions, and deletes the token.
    OPENROUTER_API_KEY is used only to enforce the live-spend ceiling.
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [string] $OpenRouterEnvFile,
    [decimal] $MaxAdditionalSpendUsd = 0.13,
    [switch] $Quick
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$platformEnv = Read-EnvFile -Path (Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev')
$base = "http://$($platformEnv['PLATFORM_HTTP_HOST']):$($platformEnv['PLATFORM_HTTP_PORT'])"
if (-not $OpenRouterEnvFile) { $OpenRouterEnvFile = Join-Path $root 'deploy/.env.openrouter.local' }
$providerEnv = Read-EnvFile -Path $OpenRouterEnvFile
$openRouterKey = if ($providerEnv.Contains('OPENROUTER_API_KEY')) { "$($providerEnv['OPENROUTER_API_KEY'])".Trim() } else { '' }
if (-not $openRouterKey) { throw 'OPENROUTER_API_KEY is missing or empty.' }

$publicModel = 'claude-opus-4.6'
$forbiddenStrings = @('anthropic/claude-opus-4.6', 'openrouter.ai', 'openrouter')
$results = [System.Collections.Generic.List[object]]::new()
$tokenId = $null
$userId = $null
$adminHeaders = $null
$userHeaders = $null
$apiKey = $null
$diskThresholdRaised = $false

function Add-Check([string] $Name, [bool] $Passed, [string] $Detail = '') {
    $results.Add([ordered]@{ name = $Name; status = $(if ($Passed) { 'pass' } else { 'fail' }); detail = $Detail })
    $color = if ($Passed) { 'Green' } else { 'Red' }
    Write-Host "[$(if ($Passed) {'PASS'} else {'FAIL'})] $Name$(if ($Detail) { ": $Detail" } else { '' })" -ForegroundColor $color
}

function Get-UpstreamUsage {
    $status = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/key' -Headers @{ Authorization = "Bearer $openRouterKey" } -TimeoutSec 30
    return [decimal]$status.data.usage
}

$startUsage = Get-UpstreamUsage
function Assert-SpendBudget {
    $current = Get-UpstreamUsage
    $spent = $current - $startUsage
    if ($spent -ge $MaxAdditionalSpendUsd) { throw "HYC live spend ceiling reached: $spent USD" }
    return $spent
}

function Assert-NoUpstreamLeak([string] $Text) {
    foreach ($forbidden in $forbiddenStrings) {
        if ($Text.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $false }
    }
    return $true
}

function Invoke-HycJson([string] $Path, [hashtable] $Body, [string] $ApiKey, [int] $TimeoutSec = 120) {
    return Invoke-RestMethod -Uri "$base$Path" -Method POST -Body ($Body | ConvertTo-Json -Depth 20 -Compress) `
        -ContentType 'application/json' -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec $TimeoutSec
}

function Invoke-HycSse([string] $Path, [hashtable] $Body, [string] $ApiKey, [bool] $StopAfterFirst = $false) {
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(150)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$base$Path")
    $request.Headers.Add('Authorization', "Bearer $ApiKey")
    $request.Headers.Add('Accept', 'text/event-stream')
    $request.Content = [System.Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 20 -Compress), [Text.Encoding]::UTF8, 'application/json')
    $response = $null
    $reader = $null
    try {
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $mediaType = $response.Content.Headers.ContentType.MediaType
        $privateHeaders = @($response.Headers | Where-Object { $_.Key -like 'x-openrouter-*' -or $_.Key -in @('x-generation-id', 'x-request-id') }).Count
        $reader = [IO.StreamReader]::new($response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
        $data = [System.Collections.Generic.List[string]]::new()
        $done = $false
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ($line -like 'data: *') {
                $value = $line.Substring(6)
                if ($value -eq '[DONE]') { $done = $true; break }
                if ($value) { $data.Add($value) }
                if ($StopAfterFirst -and $data.Count -ge 1) { break }
            }
        }
        return [ordered]@{ status = [int]$response.StatusCode; media_type = $mediaType; data = @($data); done = $done; private_headers = $privateHeaders }
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
        $request.Dispose()
        $client.Dispose()
    }
}

try {
    $credFile = Join-Path $root '.platform-tmp/dev-admin-credentials.txt'
    $password = ((Get-Content -LiteralPath $credFile | Where-Object { $_ -like 'password: *' }) -replace '^password: ', '')
    $login = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -Body (@{ username = 'root'; password = $password } | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 30
    if (-not $login.success) { throw 'Local admin login failed.' }
    $adminHeaders = @{ Authorization = "Bearer $($login.data.access_token)" }

    $thresholdUpdate = Invoke-RestMethod -Uri "$base/api/option/" -Method PUT -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 -Body (@{
        key = 'performance_setting.monitor_disk_threshold'; value = '98'
    } | ConvertTo-Json)
    if (-not $thresholdUpdate.success) { throw 'Could not apply the temporary development disk threshold.' }
    $diskThresholdRaised = $true

    $testUsername = "p6a$PID"
    $testPassword = "Aa1!$([Guid]::NewGuid().ToString('N').Substring(0,10))"
    $userCreated = Invoke-RestMethod -Uri "$base/api/user/" -Method POST -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 -Body (@{
        username = $testUsername; password = $testPassword; display_name = 'Phase 6A probe'; role = 1
    } | ConvertTo-Json)
    if (-not $userCreated.success) { throw 'Temporary provider-spike user creation failed.' }
    $usersResponse = Invoke-RestMethod -Uri "$base/api/user/search?keyword=$testUsername&p=0&page_size=100" -Headers $adminHeaders -TimeoutSec 30
    $users = if ($usersResponse.data.PSObject.Properties.Name -contains 'items') { $usersResponse.data.items } else { $usersResponse.data }
    $testUser = $users | Where-Object { $_.username -eq $testUsername } | Select-Object -First 1
    if (-not $testUser) { throw 'Temporary provider-spike user was not found.' }
    $userId = $testUser.id
    $userUpdated = Invoke-RestMethod -Uri "$base/api/user/" -Method PUT -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 -Body (@{
        id = $userId; username = $testUsername; display_name = 'Phase 6A probe'; role = 1; status = 1; group = 'provider-spike'; quota = 0
    } | ConvertTo-Json)
    if (-not $userUpdated.success) { throw 'Temporary user group assignment failed.' }
    $quotaAdded = Invoke-RestMethod -Uri "$base/api/user/manage" -Method POST -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 -Body (@{
        id = $userId; action = 'add_quota'; value = 2000000; mode = 'add'
    } | ConvertTo-Json)
    if (-not $quotaAdded.success) { throw 'Temporary user quota assignment failed.' }
    $userLogin = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -Body (@{ username = $testUsername; password = $testPassword } | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 30
    if (-not $userLogin.success) { throw 'Temporary provider-spike user login failed.' }
    $userHeaders = @{ Authorization = "Bearer $($userLogin.data.access_token)" }
    Add-Check 'isolated provider-spike user' $true

    $tokenName = "phase6a-model-$PID-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $tokenBody = @{
        name = $tokenName
        remain_quota = 2000000
        unlimited_quota = $false
        expired_time = [DateTimeOffset]::UtcNow.AddHours(2).ToUnixTimeSeconds()
        model_limits_enabled = $true
        model_limits = $publicModel
        group = 'provider-spike'
    } | ConvertTo-Json
    $created = Invoke-RestMethod -Uri "$base/api/token/" -Method POST -Body $tokenBody -ContentType 'application/json' -Headers $userHeaders -TimeoutSec 30
    if (-not $created.success) { throw 'Temporary token creation failed.' }
    $tokenList = Invoke-RestMethod -Uri "$base/api/token/?p=0&size=100" -Headers $userHeaders -TimeoutSec 30
    $items = if ($tokenList.data.PSObject.Properties.Name -contains 'items') { $tokenList.data.items } else { $tokenList.data }
    $token = $items | Where-Object { $_.name -eq $tokenName } | Select-Object -First 1
    if (-not $token) { throw 'Temporary token was not found.' }
    $tokenId = $token.id
    $revealed = Invoke-RestMethod -Uri "$base/api/token/$tokenId/key" -Method POST -Headers $userHeaders -TimeoutSec 30
    $apiKey = "$($revealed.data.key)"
    if ($apiKey -notlike 'sk-*') { $apiKey = "sk-$apiKey" }
    Add-Check 'temporary provider-spike token' $true

    $models = Invoke-RestMethod -Uri "$base/v1/models" -Headers @{ Authorization = "Bearer $apiKey" } -TimeoutSec 30
    $modelIds = @($models.data | ForEach-Object { $_.id })
    Add-Check '/v1/models public alias only' ($modelIds.Count -eq 1 -and $modelIds[0] -eq $publicModel -and (Assert-NoUpstreamLeak ($models | ConvertTo-Json -Depth 10 -Compress))) "count=$($modelIds.Count)"

    $chat = Invoke-HycJson '/v1/chat/completions' @{
        model = $publicModel; max_tokens = 16; stream = $false
        messages = @(@{ role = 'system'; content = 'Reply briefly.' }, @{ role = 'user'; content = 'Reply exactly: HYC_CHAT_OK' })
    } $apiKey
    $chatText = $chat | ConvertTo-Json -Depth 20 -Compress
    Add-Check 'Chat non-stream + system + usage' ($chat.model -eq $publicModel -and $chat.usage.total_tokens -gt 0 -and (Assert-NoUpstreamLeak $chatText)) "tokens=$($chat.usage.total_tokens)"
    [void](Assert-SpendBudget)

    $chatSse = Invoke-HycSse '/v1/chat/completions' @{
        model = $publicModel; max_tokens = 16; stream = $true
        messages = @(@{ role = 'user'; content = 'Reply exactly: HYC_SSE_OK' })
    } $apiKey
    $chatSseText = $chatSse.data -join ''
    $chatModels = @($chatSse.data | ForEach-Object { try { ($_ | ConvertFrom-Json).model } catch { $null } } | Where-Object { $_ })
    Add-Check 'Chat SSE model/header privacy' ($chatSse.status -eq 200 -and $chatSse.done -and $chatModels.Count -gt 0 -and @($chatModels | Where-Object { $_ -ne $publicModel }).Count -eq 0 -and $chatSse.private_headers -eq 0 -and (Assert-NoUpstreamLeak $chatSseText)) "chunks=$($chatSse.data.Count)"
    [void](Assert-SpendBudget)

    $messages = Invoke-HycJson '/v1/messages' @{
        model = $publicModel; max_tokens = 16; stream = $false; system = 'Reply briefly.'
        messages = @(@{ role = 'user'; content = 'Reply exactly: HYC_MESSAGES_OK' })
    } $apiKey
    $messagesText = $messages | ConvertTo-Json -Depth 20 -Compress
    Add-Check 'Messages non-stream + usage + stop reason' ($messages.model -eq $publicModel -and $messages.usage.output_tokens -gt 0 -and $messages.stop_reason -and (Assert-NoUpstreamLeak $messagesText)) "stop=$($messages.stop_reason)"

    $messagesSse = Invoke-HycSse '/v1/messages' @{
        model = $publicModel; max_tokens = 16; stream = $true
        messages = @(@{ role = 'user'; content = 'Reply exactly: HYC_MESSAGES_SSE_OK' })
    } $apiKey
    $messagesSseText = $messagesSse.data -join ''
    Add-Check 'Messages SSE privacy' ($messagesSse.status -eq 200 -and $messagesSse.data.Count -gt 1 -and (Assert-NoUpstreamLeak $messagesSseText)) "events=$($messagesSse.data.Count)"
    [void](Assert-SpendBudget)

    if (-not $Quick) {
    $tool = Invoke-HycJson '/v1/messages' @{
        model = $publicModel; max_tokens = 64
        tools = @(@{ name = 'get_weather'; description = 'Get weather.'; input_schema = @{ type = 'object'; properties = @{ city = @{ type = 'string' } }; required = @('city') } })
        tool_choice = @{ type = 'tool'; name = 'get_weather' }
        messages = @(@{ role = 'user'; content = 'Use get_weather for Paris.' })
    } $apiKey
    $toolBlock = $tool.content | Where-Object { $_.type -eq 'tool_use' } | Select-Object -First 1
    Add-Check 'Messages tool use' ($null -ne $toolBlock -and $toolBlock.name -eq 'get_weather')
    if ($toolBlock) {
        $toolResult = Invoke-HycJson '/v1/messages' @{
            model = $publicModel; max_tokens = 16
            tools = @(@{ name = 'get_weather'; description = 'Get weather.'; input_schema = @{ type = 'object'; properties = @{ city = @{ type = 'string' } }; required = @('city') } })
            messages = @(
                @{ role = 'user'; content = 'Use get_weather for Paris.' },
                @{ role = 'assistant'; content = @($toolBlock) },
                @{ role = 'user'; content = @(@{ type = 'tool_result'; tool_use_id = $toolBlock.id; content = 'sunny' }) }
            )
        } $apiKey
        Add-Check 'Messages tool result' ($toolResult.stop_reason -and $toolResult.usage.output_tokens -gt 0)
    }
    [void](Assert-SpendBudget)

    $cachePrefix = ('cache ' * 4500)
    $cacheBody = @{
        model = $publicModel; max_tokens = 8
        system = @(@{ type = 'text'; text = $cachePrefix; cache_control = @{ type = 'ephemeral' } })
        messages = @(@{ role = 'user'; content = 'Reply: CACHE_OK' })
    }
    $cacheFirst = Invoke-HycJson '/v1/messages' $cacheBody $apiKey
    $cacheSecond = Invoke-HycJson '/v1/messages' $cacheBody $apiKey
    $cacheObserved = $cacheFirst.usage.cache_creation_input_tokens -gt 0 -or $cacheSecond.usage.cache_read_input_tokens -gt 0
    Add-Check 'Messages prompt cache usage' $cacheObserved "write=$($cacheFirst.usage.cache_creation_input_tokens), read=$($cacheSecond.usage.cache_read_input_tokens)"
    [void](Assert-SpendBudget)

    $reasoning = Invoke-HycJson '/v1/messages' @{
        model = $publicModel; max_tokens = 1025; thinking = @{ type = 'enabled'; budget_tokens = 1024 }
        messages = @(@{ role = 'user'; content = 'Think briefly, then answer: what is 1+1?' })
    } $apiKey 150
    $thinkingBlock = $reasoning.content | Where-Object { $_.type -eq 'thinking' } | Select-Object -First 1
    Add-Check 'Messages reasoning' ($null -ne $thinkingBlock -and $reasoning.usage.output_tokens -gt 0) "output_tokens=$($reasoning.usage.output_tokens)"
    [void](Assert-SpendBudget)

    $responses = Invoke-HycJson '/v1/responses' @{
        model = $publicModel; max_output_tokens = 16; stream = $false; input = 'Reply exactly: HYC_RESPONSES_OK'
    } $apiKey
    $responsesText = $responses | ConvertTo-Json -Depth 20 -Compress
    Add-Check 'Responses non-stream (Beta)' ($responses.model -eq $publicModel -and $responses.usage.total_tokens -gt 0 -and (Assert-NoUpstreamLeak $responsesText)) "tokens=$($responses.usage.total_tokens)"

    $responsesSse = Invoke-HycSse '/v1/responses' @{
        model = $publicModel; max_output_tokens = 16; stream = $true; input = 'Reply exactly: HYC_RESPONSES_SSE_OK'
    } $apiKey
    Add-Check 'Responses SSE (Beta)' ($responsesSse.status -eq 200 -and $responsesSse.data.Count -gt 1 -and (Assert-NoUpstreamLeak ($responsesSse.data -join ''))) "events=$($responsesSse.data.Count)"
    [void](Assert-SpendBudget)
    }

    Start-Sleep -Seconds 8
    $tokenBeforeFailure = (Invoke-RestMethod -Uri "$base/api/token/?p=0&size=100" -Headers $userHeaders).data
    $tokenItems = if ($tokenBeforeFailure.PSObject.Properties.Name -contains 'items') { $tokenBeforeFailure.items } else { $tokenBeforeFailure }
    $usedBeforeFailure = [int64](($tokenItems | Where-Object { $_.id -eq $tokenId }).used_quota)
    $forbiddenRejected = $false
    try {
        [void](Invoke-HycJson '/v1/chat/completions' @{ model = $publicModel; messages = @(@{ role = 'user'; content = 'hi' }); max_tokens = 8; provider = @{ order = @('untrusted') } } $apiKey)
    } catch { $forbiddenRejected = $true }
    $slugRejected = $false
    try {
        [void](Invoke-HycJson '/v1/chat/completions' @{ model = 'anthropic/claude-opus-4.6'; messages = @(@{ role = 'user'; content = 'hi' }); max_tokens = 8 } $apiKey)
    } catch { $slugRejected = $true }
    Start-Sleep -Seconds 6
    $tokenAfterFailure = (Invoke-RestMethod -Uri "$base/api/token/?p=0&size=100" -Headers $userHeaders).data
    $tokenItemsAfter = if ($tokenAfterFailure.PSObject.Properties.Name -contains 'items') { $tokenAfterFailure.items } else { $tokenAfterFailure }
    $usedAfterFailure = [int64](($tokenItemsAfter | Where-Object { $_.id -eq $tokenId }).used_quota)
    Add-Check 'provider control rejected without billing' ($forbiddenRejected -and $usedAfterFailure -eq $usedBeforeFailure)
    Add-Check 'upstream slug rejected without billing' ($slugRejected -and $usedAfterFailure -eq $usedBeforeFailure)

    $interrupted = Invoke-HycSse '/v1/chat/completions' @{
        model = $publicModel; max_tokens = 32; stream = $true
        messages = @(@{ role = 'user'; content = 'Count slowly from one to ten.' })
    } $apiKey $true
    Add-Check 'SSE client interruption observed' ($interrupted.status -eq 200 -and $interrupted.data.Count -eq 1)
    Start-Sleep -Seconds 6
    $logs = Invoke-RestMethod -Uri "$base/api/log/self?p=0&size=100" -Headers $userHeaders -TimeoutSec 30
    $logItems = if ($logs.data.PSObject.Properties.Name -contains 'items') { $logs.data.items } else { $logs.data }
    $ourLogs = @($logItems | Where-Object { $_.token_name -eq $tokenName })
    $logText = $ourLogs | ConvertTo-Json -Depth 12 -Compress
    $logRoutePrivate = @($ourLogs | Where-Object {
        $upstreamId = if ($_.PSObject.Properties.Name -contains 'upstream_request_id') { "$($_.upstream_request_id)" } else { '' }
        [int]$_.channel -ne 0 -or -not [string]::IsNullOrWhiteSpace($upstreamId)
    }).Count
    $minimumLogCount = if ($Quick) { 5 } else { 8 }
    Add-Check 'consumption logs use public alias' ($ourLogs.Count -ge $minimumLogCount -and $logRoutePrivate -eq 0 -and (Assert-NoUpstreamLeak $logText)) "count=$($ourLogs.Count)"

    $spent = Assert-SpendBudget
    Add-Check 'HYC live spend ceiling' ($spent -lt $MaxAdditionalSpendUsd) "spent_usd=$spent"
} finally {
    if ($tokenId -and $userHeaders) {
        try {
            $deleted = Invoke-RestMethod -Uri "$base/api/token/$tokenId" -Method DELETE -Headers $userHeaders -TimeoutSec 30
            Add-Check 'temporary token cleanup' ([bool]$deleted.success)
        } catch {
            Add-Check 'temporary token cleanup' $false
        }
    }
    if ($userId -and $adminHeaders) {
        try {
            $userDeleted = Invoke-RestMethod -Uri "$base/api/user/$userId" -Method DELETE -Headers $adminHeaders -TimeoutSec 30
            Add-Check 'temporary user cleanup' ([bool]$userDeleted.success)
        } catch {
            Add-Check 'temporary user cleanup' $false
        }
    }
    if ($diskThresholdRaised -and $adminHeaders) {
        try {
            $thresholdRestored = Invoke-RestMethod -Uri "$base/api/option/" -Method PUT -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 -Body (@{
                key = 'performance_setting.monitor_disk_threshold'; value = '95'
            } | ConvertTo-Json)
            Add-Check 'development disk threshold restored' ([bool]$thresholdRestored.success)
        } catch {
            Add-Check 'development disk threshold restored' $false
        }
    }
    $openRouterKey = $null
    $apiKey = $null
}

$failed = @($results | Where-Object { $_.status -eq 'fail' }).Count
$summary = [ordered]@{
    timestamp_utc = [DateTime]::UtcNow.ToString('o')
    public_model = $publicModel
    checks = $results
    passed = @($results | Where-Object { $_.status -eq 'pass' }).Count
    failed = $failed
}
$outputDir = Join-Path $root '.local-tests/openrouter'
if (-not (Test-Path -LiteralPath $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
$outputPath = Join-Path $outputDir ("hyc-{0}-summary.json" -f ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')))
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Host "Sanitized summary: $outputPath" -ForegroundColor DarkGray
if ($failed -gt 0) { exit 1 }
