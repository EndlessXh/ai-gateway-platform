<#
.SYNOPSIS
Runs the Relay regression matrix against an isolated loopback stub.

.DESCRIPTION
Builds a temporary gateway backed by a run-scoped SQLite database, creates one
OpenRouter-shaped channel that can only reach a local deterministic stub, and
exercises login, token, wallet, Chat, Messages, SSE, tools, errors, timeout and
interrupted-stream settlement. The default run uses no Provider credential,
does not touch the development database, and deletes its database and Sessions.
#>
[CmdletBinding()]
param(
    [ValidateRange(0, 65535)]
    [int] $GatewayPort = 0,
    [ValidateRange(0, 65535)]
    [int] $StubPort = 0,
    [switch] $KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$publicModel = 'local-relay-smoke'
$claudeCodeModel = 'claude-opus-4.6'
$portReservations = [Collections.Generic.List[Net.Sockets.TcpListener]]::new()
function Reserve-LoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $script:portReservations.Add($listener)
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
}
if ($GatewayPort -eq 0) { $GatewayPort = Reserve-LoopbackPort }
if ($StubPort -eq 0) { $StubPort = Reserve-LoopbackPort }
if ($GatewayPort -eq $StubPort) { throw 'Gateway and stub ports must differ.' }
foreach ($reservation in $portReservations) { $reservation.Stop() }
$portReservations.Clear()
$runId = "relay-smoke-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$runsRoot = [IO.Path]::GetFullPath((Join-Path $root '.platform-tmp/relay-smoke/runs'))
$runDir = [IO.Path]::GetFullPath((Join-Path $runsRoot $runId))
if (-not $runDir.StartsWith($runsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing an unsafe Relay smoke temporary path.'
}
if (Get-NetTCPConnection -State Listen -LocalPort $GatewayPort,$StubPort -ErrorAction SilentlyContinue) {
    throw "Gateway/stub ports must be free: $GatewayPort, $StubPort"
}

New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$stubExe = Join-Path $runDir 'relay-stub.exe'
$gatewayExe = Join-Path $runDir 'hyc-gateway-smoke.exe'
$dbPath = Join-Path $runDir 'relay-smoke.db'
$stubOut = Join-Path $runDir 'stub.stdout.log'
$stubErr = Join-Path $runDir 'stub.stderr.log'
$gatewayOut = Join-Path $runDir 'gateway.stdout.log'
$gatewayErr = Join-Path $runDir 'gateway.stderr.log'
$gatewayBase = "http://127.0.0.1:$GatewayPort"
$stubBase = "http://127.0.0.1:$StubPort"
$stubProcess = $null
$gatewayProcess = $null
$checks = [Collections.Generic.List[object]]::new()
$failed = $false

function Add-Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    $script:checks.Add([pscustomobject]@{ name = $Name; status = if ($Ok) { 'pass' } else { 'fail' }; detail = $Detail })
    $mark = if ($Ok) { '[ OK ]' } else { '[FAIL]' }
    Write-Host ("{0} {1,-42} {2}" -f $mark, $Name, $Detail) -ForegroundColor $(if ($Ok) { 'Green' } else { 'Red' })
    if (-not $Ok) { $script:failed = $true }
}

function Wait-Http {
    param([string] $Uri, [int] $Seconds = 60)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 2 -SkipHttpErrorCheck
            if ([int]$response.StatusCode -lt 500) { return }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for $Uri"
}

function Invoke-RelayJson {
    param([string] $Path, [hashtable] $Body, [string] $Token, [int] $TimeoutSec = 15)
    $response = Invoke-WebRequest -Uri "$gatewayBase$Path" -Method POST -TimeoutSec $TimeoutSec -ContentType 'application/json' `
        -Headers @{ Authorization = "Bearer $Token" } -Body ($Body | ConvertTo-Json -Depth 30 -Compress) -SkipHttpErrorCheck
    if ([int]$response.StatusCode -ge 400) {
		$errorPayload = $null
		try { $errorPayload = $response.Content | ConvertFrom-Json } catch { }
		$errorType = if ($errorPayload -and $errorPayload.error) { "$($errorPayload.error.type)" } else { '' }
		$errorCode = if ($errorPayload -and $errorPayload.error) { "$($errorPayload.error.code)" } else { '' }
        $errorClass = if ($response.Content -match 'available|可用') { 'no_channel' } `
            elseif ($response.Content -match 'routing control') { 'routing_control' } `
            elseif ($response.Content -match 'authentication|unauthorized') { 'authentication' } else { 'other' }
        throw "Relay $Path failed: status=$([int]$response.StatusCode), class=$errorClass, type=$errorType, code=$errorCode"
    }
    return ($response.Content | ConvertFrom-Json)
}

function Invoke-RelayRaw {
    param([string] $Path, [hashtable] $Body, [string] $Token, [int] $TimeoutSec = 15)
    Invoke-WebRequest -Uri "$gatewayBase$Path" -Method POST -TimeoutSec $TimeoutSec -ContentType 'application/json' `
        -Headers @{ Authorization = "Bearer $Token" } -Body ($Body | ConvertTo-Json -Depth 30 -Compress) -SkipHttpErrorCheck
}

function Invoke-RelaySse {
    param([string] $Path, [hashtable] $Body, [string] $Token)
    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$gatewayBase$Path")
    $request.Headers.Add('Authorization', "Bearer $Token")
    $request.Headers.Add('Accept', 'text/event-stream')
    $request.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 30 -Compress), [Text.Encoding]::UTF8, 'application/json')
    $response = $null
    $reader = $null
    try {
        $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $reader = [IO.StreamReader]::new($response.Content.ReadAsStream())
        $events = [Collections.Generic.List[string]]::new()
        $done = $false
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ($line -like 'data: *') {
                $value = $line.Substring(6)
                if ($value -eq '[DONE]') { $done = $true; break }
                $events.Add($value)
            }
        }
        return [pscustomobject]@{
            status = [int]$response.StatusCode
            media_type = "$($response.Content.Headers.ContentType.MediaType)"
            events = @($events)
            done = $done
            private_headers = @($response.Headers | Where-Object { $_.Key -like 'x-openrouter-*' }).Count
        }
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
        $request.Dispose()
        $client.Dispose()
    }
}

function Set-RatioOption {
    param([string] $Key, [hashtable] $Value, [hashtable] $Headers)
    $body = @{ key = $Key; value = ($Value | ConvertTo-Json -Compress) } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Uri "$gatewayBase/api/option/" -Method PUT -Headers $Headers -ContentType 'application/json' -Body $body
    if (-not $response.success) { throw "Failed to set $Key" }
}

function Get-StableTokenUsage {
    param([int] $TokenId, [hashtable] $Headers, [int] $TimeoutSeconds = 8)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $last = $null
    $stableReads = 0
    while ((Get-Date) -lt $deadline) {
        $response = Invoke-RestMethod -Uri "$gatewayBase/api/token/?p=0&size=100" -Headers $Headers
        $items = if ($response.data.PSObject.Properties.Name -contains 'items') { $response.data.items } else { $response.data }
        $used = [int64](($items | Where-Object { $_.id -eq $TokenId }).used_quota)
        if ($null -ne $last -and $used -eq $last) { $stableReads++ } else { $stableReads = 0 }
        if ($stableReads -ge 3) { return $used }
        $last = $used
        Start-Sleep -Milliseconds 300
    }
    throw "Token usage did not stabilize for token $TokenId."
}

try {
    Write-Host 'AI Gateway Platform - deterministic local Relay smoke' -ForegroundColor Cyan
    Write-Host ('-' * 86)
    $env:GOCACHE = Join-Path $root '.platform-tmp/go-build-cache'
    & go build -o $stubExe ./cmd/relay-stub
    if ($LASTEXITCODE -ne 0) { throw 'Relay stub build failed.' }
    & go build -o $gatewayExe .
    if ($LASTEXITCODE -ne 0) { throw 'Gateway smoke build failed.' }

    $stubProcess = Start-Process -FilePath $stubExe -ArgumentList @('-listen', "127.0.0.1:$StubPort") `
        -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stubOut -RedirectStandardError $stubErr -PassThru
    Wait-Http "$stubBase/healthz" 20
    Add-Check 'loopback stub ready' $true "port=$StubPort"

    $gatewayEnvironment = @{
        SQLITE_PATH = $dbPath
        SQL_DSN = ''
        LOG_SQL_DSN = ''
        REDIS_CONN_STRING = ''
        SESSION_SECRET = [Guid]::NewGuid().ToString('N')
        CRYPTO_SECRET = [Guid]::NewGuid().ToString('N')
        NODE_NAME = 'relay-smoke-local'
        NODE_TYPE = 'master'
        PORT = "$GatewayPort"
        GIN_MODE = 'release'
        DEBUG = 'false'
        MEMORY_CACHE_ENABLED = 'false'
        BATCH_UPDATE_ENABLED = 'false'
        PRICING_STATUS = 'provisional'
        SOURCE_CODE_URL = ''
        HTTP_PROXY = ''
        HTTPS_PROXY = ''
        ALL_PROXY = ''
        NO_PROXY = '127.0.0.1,localhost'
        TRUSTED_PROXIES = 'none'
        OPENROUTER_API_KEY = ''
        ANTHROPIC_API_KEY = ''
        ANTHROPIC_AUTH_TOKEN = ''
    }
    $gatewayProcess = Start-Process -FilePath $gatewayExe -ArgumentList @('--port', "$GatewayPort", '--log-dir', (Join-Path $runDir 'logs')) `
        -WorkingDirectory $root -WindowStyle Hidden -Environment $gatewayEnvironment `
        -RedirectStandardOutput $gatewayOut -RedirectStandardError $gatewayErr -PassThru
    Wait-Http "$gatewayBase/api/status" 90
    Add-Check 'isolated SQLite gateway ready' (Test-Path -LiteralPath $dbPath) "port=$GatewayPort"

    $rootPassword = "Aa1!$([Guid]::NewGuid().ToString('N').Substring(0,16))"
    $setup = Invoke-RestMethod -Uri "$gatewayBase/api/setup" -Method POST -ContentType 'application/json' -Body (@{
        username = 'root'; password = $rootPassword; confirmPassword = $rootPassword
        SelfUseModeEnabled = $false; DemoSiteEnabled = $false
    } | ConvertTo-Json -Compress)
    if (-not $setup.success) { throw "Isolated gateway setup failed: $($setup.message)" }
    $login = Invoke-RestMethod -Uri "$gatewayBase/api/user/login" -Method POST -ContentType 'application/json' `
        -UserAgent "HYC-E2E/$runId" -Body (@{ username = 'root'; password = $rootPassword } | ConvertTo-Json -Compress)
    if (-not $login.success) { throw 'Isolated gateway login failed.' }
    $adminHeaders = @{ Authorization = "Bearer $($login.data.access_token)" }
    Add-Check 'login regression' $true 'isolated root session'

    $diskThreshold = Invoke-RestMethod -Uri "$gatewayBase/api/option/" -Method PUT -Headers $adminHeaders `
        -ContentType 'application/json' -Body (@{ key = 'performance_setting.monitor_disk_threshold'; value = '100' } | ConvertTo-Json -Compress)
    if (-not $diskThreshold.success) { throw 'Could not disable the isolated disk pressure guard.' }

    Set-RatioOption 'ModelRatio' @{ $publicModel = 1.0; $claudeCodeModel = 1.0 } $adminHeaders
    Set-RatioOption 'CompletionRatio' @{ $publicModel = 1.0; $claudeCodeModel = 1.0 } $adminHeaders
    Set-RatioOption 'CacheRatio' @{ $publicModel = 0.1; $claudeCodeModel = 0.1 } $adminHeaders
    Set-RatioOption 'CreateCacheRatio' @{ $publicModel = 1.25; $claudeCodeModel = 1.25 } $adminHeaders
    Set-RatioOption 'GroupRatio' @{ default = 1.0 } $adminHeaders

    $mapping = @{ $publicModel = 'private-stub-model' } | ConvertTo-Json -Compress
    $channel = @{
        mode = 'single'
        channel = @{
            name = $runId; type = 20; key = 'local-stub-credential'; base_url = $stubBase
            models = $publicModel; model_mapping = $mapping; group = 'default'; status = 1
            auto_ban = 0; setting = '{}'
        }
    }
    $createdChannel = Invoke-RestMethod -Uri "$gatewayBase/api/channel/" -Method POST -Headers $adminHeaders `
        -ContentType 'application/json' -Body ($channel | ConvertTo-Json -Depth 8 -Compress)
    if (-not $createdChannel.success) { throw "Local channel creation failed: $($createdChannel.message)" }
    Add-Check 'stub-only channel created' $true 'OpenRouter adapter, loopback base URL'

    $claudeChannel = @{
        mode = 'single'
        channel = @{
            name = "$runId-claude"; type = 20; key = 'local-stub-credential'; base_url = $stubBase
            models = $claudeCodeModel
            model_mapping = (@{ $claudeCodeModel = 'private-stub-model' } | ConvertTo-Json -Compress)
            group = 'default'; status = 1; auto_ban = 0; setting = '{}'
        }
    }
    $createdClaudeChannel = Invoke-RestMethod -Uri "$gatewayBase/api/channel/" -Method POST -Headers $adminHeaders `
        -ContentType 'application/json' -Body ($claudeChannel | ConvertTo-Json -Depth 8 -Compress)
    if (-not $createdClaudeChannel.success) { throw "Claude loopback channel creation failed: $($createdClaudeChannel.message)" }
    Add-Check 'Claude Code loopback channel created' $true 'approved public alias only'

    $tokenName = $runId
    $createdToken = Invoke-RestMethod -Uri "$gatewayBase/api/token/" -Method POST -Headers $adminHeaders -ContentType 'application/json' -Body (@{
        name = $tokenName; remain_quota = 1000000; unlimited_quota = $false
        expired_time = [DateTimeOffset]::UtcNow.AddMinutes(30).ToUnixTimeSeconds()
        model_limits_enabled = $true; model_limits = $publicModel; group = 'default'
    } | ConvertTo-Json -Compress)
    if (-not $createdToken.success) { throw 'Local smoke token creation failed.' }
    $tokenList = Invoke-RestMethod -Uri "$gatewayBase/api/token/?p=0&size=100" -Headers $adminHeaders
    $items = if ($tokenList.data.PSObject.Properties.Name -contains 'items') { $tokenList.data.items } else { $tokenList.data }
    $token = $items | Where-Object { $_.name -eq $tokenName } | Select-Object -First 1
    if (-not $token) { throw 'Local smoke token was not listed.' }
    $revealed = Invoke-RestMethod -Uri "$gatewayBase/api/token/$($token.id)/key" -Method POST -Headers $adminHeaders
    $apiKey = "$($revealed.data.key)"
    if ($apiKey -notlike 'sk-*') { $apiKey = "sk-$apiKey" }
    Add-Check 'token regression' $true 'model-scoped temporary token'

    $claudeTokenName = "$runId-claude"
    $createdClaudeToken = Invoke-RestMethod -Uri "$gatewayBase/api/token/" -Method POST -Headers $adminHeaders -ContentType 'application/json' -Body (@{
        name = $claudeTokenName; remain_quota = 1000000; unlimited_quota = $false
        expired_time = [DateTimeOffset]::UtcNow.AddMinutes(30).ToUnixTimeSeconds()
        model_limits_enabled = $true; model_limits = $claudeCodeModel; group = 'default'
    } | ConvertTo-Json -Compress)
    if (-not $createdClaudeToken.success) { throw 'Local Claude Code token creation failed.' }
    $tokenList = Invoke-RestMethod -Uri "$gatewayBase/api/token/?p=0&size=100" -Headers $adminHeaders
    $items = if ($tokenList.data.PSObject.Properties.Name -contains 'items') { $tokenList.data.items } else { $tokenList.data }
    $claudeToken = $items | Where-Object { $_.name -eq $claudeTokenName } | Select-Object -First 1
    $claudeRevealed = Invoke-RestMethod -Uri "$gatewayBase/api/token/$($claudeToken.id)/key" -Method POST -Headers $adminHeaders
    $claudeApiKey = "$($claudeRevealed.data.key)"
    if ($claudeApiKey -notlike 'sk-*') { $claudeApiKey = "sk-$claudeApiKey" }

    $walletBefore = (Invoke-RestMethod -Uri "$gatewayBase/api/user/self" -Headers $adminHeaders).data
    $currentSubscriptions = Invoke-RestMethod -Uri "$gatewayBase/api/platform/subscriptions/current" -Headers $adminHeaders
    $historySubscriptions = Invoke-RestMethod -Uri "$gatewayBase/api/platform/subscriptions/history" -Headers $adminHeaders
    Add-Check 'wallet regression read' ($walletBefore.quota -gt 0)
    Add-Check 'subscription regression read' ($currentSubscriptions.success -and $historySubscriptions.success)

    $chat = Invoke-RelayJson '/v1/chat/completions' @{
        model = $publicModel; stream = $false; max_tokens = 16
        messages = @(@{ role = 'user'; content = 'LOCAL_CHAT' })
    } $apiKey
    Add-Check 'Chat non-stream + usage' ($chat.model -eq $publicModel -and $chat.choices[0].message.content -eq 'LOCAL_SMOKE_OK' -and $chat.usage.total_tokens -eq 11)

    $chatSse = Invoke-RelaySse '/v1/chat/completions' @{
        model = $publicModel; stream = $true; max_tokens = 16
        messages = @(@{ role = 'user'; content = 'LOCAL_CHAT_SSE' })
    } $apiKey
    $chatSseText = $chatSse.events -join ''
    Add-Check 'Chat SSE + privacy' ($chatSse.status -eq 200 -and $chatSse.done -and $chatSse.events.Count -ge 3 -and $chatSse.private_headers -eq 0 -and $chatSseText -notmatch 'private-stub-model|OpenRouter')

    $messages = Invoke-RelayJson '/v1/messages' @{
        model = $publicModel; stream = $false; max_tokens = 16; system = 'Local system instruction.'
        messages = @(@{ role = 'user'; content = 'LOCAL_MESSAGES' })
    } $apiKey
    Add-Check 'Messages non-stream + usage' ($messages.model -eq $publicModel -and $messages.content[0].text -eq 'LOCAL_SMOKE_OK' -and $messages.usage.output_tokens -eq 3)

    $messagesSse = Invoke-RelaySse '/v1/messages' @{
        model = $publicModel; stream = $true; max_tokens = 16
        messages = @(@{ role = 'user'; content = 'LOCAL_MESSAGES_SSE' })
    } $apiKey
    Add-Check 'Messages SSE' ($messagesSse.status -eq 200 -and $messagesSse.events.Count -ge 3 -and (($messagesSse.events -join '') -notmatch 'private-stub-model|OpenRouter'))

    $claudeEnv = Join-Path $runDir 'claude-code.env'
    @(
        "HYC_API_BASE_URL=$gatewayBase"
        "HYC_API_TOKEN=$claudeApiKey"
        "HYC_PUBLIC_MODEL=$claudeCodeModel"
    ) | Set-Content -LiteralPath $claudeEnv -Encoding utf8
    $persistentEnvironmentBefore = @{}
    foreach ($scope in @('User', 'Machine')) {
        foreach ($name in @('ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL')) {
            $persistentEnvironmentBefore["$scope/$name"] = [Environment]::GetEnvironmentVariable($name, $scope)
        }
    }
    $claudeOutput = @(& pwsh -NoProfile -File (Join-Path $root 'scripts/run-claude-code-hyc.ps1') `
        -EnvFile $claudeEnv -WorkingDirectory $runDir -Minimal -TimeoutSeconds 30 `
        -Print 'Reply with exactly CLAUDE_CODE_HYC_OK.' 2>&1) -join "`n"
    $claudeExit = $LASTEXITCODE
    Add-Check 'native Claude Code through HYC' ($claudeExit -eq 0 -and $claudeOutput -match 'CLAUDE_CODE_HYC_OK') "exit=$claudeExit"
    Add-Check 'Claude launcher output hides token' ($claudeOutput -notmatch [Regex]::Escape($claudeApiKey))
    $persistentEnvironmentUnchanged = $true
    foreach ($entry in $persistentEnvironmentBefore.GetEnumerator()) {
        $scope, $name = $entry.Key.Split('/', 2)
        if ([Environment]::GetEnvironmentVariable($name, $scope) -ne $entry.Value) { $persistentEnvironmentUnchanged = $false }
    }
    Add-Check 'Claude launcher leaves global environment' $persistentEnvironmentUnchanged
    $claudeShape = (Invoke-RestMethod -Uri "$stubBase/__stub/state").last_message_shape
    $safeClaudeShape = $claudeShape.format -eq 'openai_chat' -and $claudeShape.max_tokens -eq 4096 -and `
        $claudeShape.system_messages -eq 1 -and $claudeShape.tools_count -eq 0 -and `
        -not $claudeShape.reasoning_present -and $claudeShape.provider_data_collection -eq 'deny' -and `
        $claudeShape.provider_zdr -and $claudeShape.provider_require_parameters
    Add-Check 'Claude Code converted request shape' $safeClaudeShape 'metadata removed; privacy policy enforced'

    $tool = Invoke-RelayJson '/v1/messages' @{
        model = $publicModel; max_tokens = 32
        tools = @(@{ name = 'get_weather'; description = 'Local deterministic tool.'; input_schema = @{ type = 'object'; properties = @{ city = @{ type = 'string' } } } })
        tool_choice = @{ type = 'tool'; name = 'get_weather' }
        messages = @(@{ role = 'user'; content = 'Call the local tool.' })
    } $apiKey
    $toolUse = $tool.content | Where-Object { $_.type -eq 'tool_use' } | Select-Object -First 1
    Add-Check 'tool use' ($toolUse -and $toolUse.name -eq 'get_weather')
    $toolResult = Invoke-RelayJson '/v1/messages' @{
        model = $publicModel; max_tokens = 16
        tools = @(@{ name = 'get_weather'; description = 'Local deterministic tool.'; input_schema = @{ type = 'object'; properties = @{ city = @{ type = 'string' } } } })
        messages = @(
            @{ role = 'user'; content = 'Call the local tool.' },
            @{ role = 'assistant'; content = @($toolUse) },
            @{ role = 'user'; content = @(@{ type = 'tool_result'; tool_use_id = $toolUse.id; content = 'sunny' }) }
        )
    } $apiKey
    Add-Check 'tool result continuation' ($toolResult.content[0].text -eq 'TOOL_RESULT_OK')

    $usedAfterSuccess = Get-StableTokenUsage $token.id $adminHeaders
    Add-Check 'successful requests billed' ($usedAfterSuccess -gt 0) "used_quota=$usedAfterSuccess"

    $errorCases = @(
        @{ marker = 'STUB_401'; status = 401; retry = '' },
        @{ marker = 'STUB_429'; status = 429; retry = '7' },
        @{ marker = 'STUB_500'; status = 500; retry = '' }
    )
    foreach ($case in $errorCases) {
        $errorResponse = Invoke-RelayRaw '/v1/chat/completions' @{
            model = $publicModel; max_tokens = 8; messages = @(@{ role = 'user'; content = $case.marker })
        } $apiKey
        $safeError = $errorResponse.Content -notmatch 'private stub|private-stub-model|OpenRouter|openrouter'
        $retry = $errorResponse.Headers['Retry-After']
        Add-Check "error $($case.status) mapping" ([int]$errorResponse.StatusCode -eq $case.status -and $safeError -and (!$case.retry -or "$retry" -eq $case.retry))
    }

    $usedAfterErrors = Get-StableTokenUsage $token.id $adminHeaders
    Add-Check '401/429/5xx requests unbilled' ($usedAfterErrors -eq $usedAfterSuccess) "used_quota=$usedAfterErrors"

    $timeoutObserved = $false
    $timeoutClient = [Net.Http.HttpClient]::new()
    $timeoutClient.Timeout = [Threading.Timeout]::InfiniteTimeSpan
    $timeoutRequest = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$gatewayBase/v1/chat/completions")
    $timeoutRequest.Headers.Add('Authorization', "Bearer $apiKey")
    $timeoutBody = @{
        model = $publicModel; max_tokens = 8; messages = @(@{ role = 'user'; content = 'STUB_TIMEOUT' })
    } | ConvertTo-Json -Depth 10 -Compress
    $timeoutRequest.Content = [Net.Http.StringContent]::new($timeoutBody, [Text.Encoding]::UTF8, 'application/json')
    $timeoutCancellation = [Threading.CancellationTokenSource]::new()
    $timeoutCancellation.CancelAfter([TimeSpan]::FromSeconds(1))
    try {
        [void]$timeoutClient.SendAsync($timeoutRequest, $timeoutCancellation.Token).GetAwaiter().GetResult()
    } catch { $timeoutObserved = $true }
    finally {
        $timeoutCancellation.Dispose()
        $timeoutRequest.Dispose()
        $timeoutClient.Dispose()
    }
    Add-Check 'client timeout cancellation' $timeoutObserved

    $cancelDeadline = (Get-Date).AddSeconds(7)
    do {
        Start-Sleep -Milliseconds 250
        $stubState = Invoke-RestMethod -Uri "$stubBase/__stub/state"
    } while ($stubState.cancelled -lt 1 -and (Get-Date) -lt $cancelDeadline)
    Add-Check 'timeout reached upstream cancellation' ($stubState.cancelled -ge 1)

    $usedAfterTimeout = Get-StableTokenUsage $token.id $adminHeaders
    Add-Check 'timed-out request unbilled' ($usedAfterTimeout -eq $usedAfterErrors) "used_quota=$usedAfterTimeout"

    $interrupted = Invoke-RelaySse '/v1/chat/completions' @{
        model = $publicModel; stream = $true; max_tokens = 16
        messages = @(@{ role = 'user'; content = 'STUB_INTERRUPT' })
    } $apiKey
    $stubState = Invoke-RestMethod -Uri "$stubBase/__stub/state"
    Add-Check 'interrupted upstream stream observed' ($stubState.interrupted -eq 1 -and $interrupted.status -eq 200 -and $interrupted.events.Count -ge 1) "events=$($interrupted.events.Count), downstream_done=$($interrupted.done)"

    $usedAfterFailures = Get-StableTokenUsage $token.id $adminHeaders
    $interruptedDelta = $usedAfterFailures - $usedAfterTimeout
    Add-Check 'interrupted stream settled to partial usage' ($interruptedDelta -gt 0 -and $interruptedDelta -lt 100) "quota_delta=$interruptedDelta"

    $stubState = Invoke-RestMethod -Uri "$stubBase/__stub/state"
    Add-Check 'no Provider credential or external route' ($stubState.requests -ge 10) "loopback_requests=$($stubState.requests)"

    $walletAfter = (Invoke-RestMethod -Uri "$gatewayBase/api/user/self" -Headers $adminHeaders).data
    Add-Check 'wallet charged only for successes' ([int64]$walletBefore.quota -gt [int64]$walletAfter.quota -and [int64]$walletAfter.used_quota -gt [int64]$walletBefore.used_quota)
} catch {
    $failed = $true
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($gatewayProcess -and -not $gatewayProcess.HasExited) { Stop-Process -Id $gatewayProcess.Id -Force }
    if ($stubProcess -and -not $stubProcess.HasExited) { Stop-Process -Id $stubProcess.Id -Force }
    Start-Sleep -Milliseconds 500

    $summaryDir = Join-Path $root '.local-tests/relay-smoke'
    New-Item -ItemType Directory -Path $summaryDir -Force | Out-Null
    $summary = [ordered]@{
        run_id = $runId
        result = if ($failed -or @($checks | Where-Object status -eq 'fail').Count -gt 0) { 'fail' } else { 'pass' }
        provider_credentials_used = $false
        external_upstream_used = $false
        database = 'run-scoped SQLite (deleted by default)'
        checks = @($checks)
    }
    $summaryPath = Join-Path $summaryDir "$runId-summary.json"
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding utf8

    if (-not $KeepArtifacts) {
        $resolvedRun = [IO.Path]::GetFullPath($runDir)
        if (-not $resolvedRun.StartsWith($runsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing unsafe Relay smoke cleanup.'
        }
        if (Test-Path -LiteralPath $resolvedRun) { Remove-Item -LiteralPath $resolvedRun -Recurse -Force }
    }
    $dbRemoved = -not (Test-Path -LiteralPath $dbPath)
    Add-Check 'temporary database and Sessions removed' $dbRemoved
    Write-Host ('-' * 86)
    Write-Host "Sanitized summary: $summaryPath" -ForegroundColor DarkGray
}

if ($failed -or @($checks | Where-Object status -eq 'fail').Count -gt 0) { exit 1 }
Write-Host 'All deterministic local Relay checks passed with zero Provider cost.' -ForegroundColor Green
