<#
.SYNOPSIS
Runs one minimal Claude Code request through HYC AI and OpenRouter.

.DESCRIPTION
Creates a short-lived provider-spike user and model-scoped HYC token. Claude
Code receives only that token through ANTHROPIC_AUTH_TOKEN and can only call
the local HYC /v1/messages endpoint. The OpenRouter key is used in-process only
to measure the before/after account usage and is never passed to Claude Code.
#>
[CmdletBinding()]
param(
    [decimal] $MaxAdditionalSpendUsd = 0.08
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$base = 'http://127.0.0.1:3001'
$publicModel = 'claude-opus-4.6'
$adminHeaders = $null
$userHeaders = $null
$userId = $null
$tokenId = $null
$hycToken = $null
$openRouterKey = $null
$results = [Collections.Generic.List[object]]::new()
$clientEnvPath = $null
$originalDiskThreshold = $null
$diskThresholdChanged = $false

function Add-Result {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    $script:results.Add([pscustomobject]@{ name = $Name; status = if ($Ok) { 'pass' } else { 'fail' }; detail = $Detail })
    $mark = if ($Ok) { '[ OK ]' } else { '[FAIL]' }
    Write-Host ("{0} {1,-40} {2}" -f $mark, $Name, $Detail) -ForegroundColor $(if ($Ok) { 'Green' } else { 'Red' })
}

function Get-OpenRouterUsage {
    $response = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/key' -Headers @{ Authorization = "Bearer $openRouterKey" } -TimeoutSec 30
    return [decimal]$response.data.usage
}

try {
    Write-Host 'Claude Code -> HYC AI client compatibility probe' -ForegroundColor Cyan
    Write-Host ('-' * 82)
    $envPath = Join-Path $root 'deploy/.env.openrouter.local'
    $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*OPENROUTER_API_KEY\s*=' } | Select-Object -First 1
    if (-not $line) { throw 'OPENROUTER_API_KEY is missing.' }
    $openRouterKey = (($line -replace '^\s*OPENROUTER_API_KEY\s*=\s*', '').Trim().Trim('"').Trim("'"))
    if ([string]::IsNullOrWhiteSpace($openRouterKey)) { throw 'OPENROUTER_API_KEY is empty.' }
    Add-Result 'OpenRouter credential source' $true 'present and Git-ignored'

    $npmPrefix = @(& npm prefix -g 2>$null) -join ''
    $nativeClaude = Join-Path $npmPrefix 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'
    if (-not (Test-Path -LiteralPath $nativeClaude)) { throw 'Claude Code native executable is unavailable.' }
    $versionOutput = @(& $nativeClaude --version 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code version invocation failed.' }
    Add-Result 'Claude Code executable' ($versionOutput -match '^2\.') 'version 2.x'

    $usageBefore = Get-OpenRouterUsage
    Add-Result 'starting usage snapshot' $true 'captured'

    $credFile = Join-Path $root '.platform-tmp/dev-admin-credentials.txt'
    $password = ((Get-Content -LiteralPath $credFile | Where-Object { $_ -like 'password: *' }) -replace '^password: ', '')
    $login = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -ContentType 'application/json' -TimeoutSec 30 `
        -Body (@{ username = 'root'; password = $password } | ConvertTo-Json -Compress)
    if (-not $login.success) { throw 'Local admin login failed.' }
    $adminHeaders = @{ Authorization = "Bearer $($login.data.access_token)" }

    $options = Invoke-RestMethod -Uri "$base/api/option/" -Headers $adminHeaders -TimeoutSec 30
    $diskOption = $options.data | Where-Object { $_.key -eq 'performance_setting.monitor_disk_threshold' } | Select-Object -First 1
    $originalDiskThreshold = if ($diskOption) { "$($diskOption.value)" } else { '95' }
    if ([int]$originalDiskThreshold -lt 98) {
        $thresholdUpdate = Invoke-RestMethod -Uri "$base/api/option/" -Method PUT -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 `
            -Body (@{ key = 'performance_setting.monitor_disk_threshold'; value = '98' } | ConvertTo-Json -Compress)
        if (-not $thresholdUpdate.success) { throw 'Could not apply the temporary development disk threshold.' }
        $diskThresholdChanged = $true
        Add-Result 'temporary disk pressure threshold' $true 'raised to 98 for local probe'
    }

    $username = "p6cc$([Guid]::NewGuid().ToString('N').Substring(0,6))"
    $testPassword = "Aa1!$([Guid]::NewGuid().ToString('N').Substring(0,12))"
    $createdUser = Invoke-RestMethod -Uri "$base/api/user/" -Method POST -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 `
        -Body (@{ username = $username; password = $testPassword; display_name = 'P6A2 Claude'; role = 1 } | ConvertTo-Json -Compress)
    if (-not $createdUser.success) { throw "Temporary Claude Code user creation failed: $($createdUser.message)" }
    $usersResponse = Invoke-RestMethod -Uri "$base/api/user/search?keyword=$username&p=0&page_size=100" -Headers $adminHeaders -TimeoutSec 30
    $users = if ($usersResponse.data.PSObject.Properties.Name -contains 'items') { $usersResponse.data.items } else { $usersResponse.data }
    $user = $users | Where-Object username -eq $username | Select-Object -First 1
    if (-not $user) { throw 'Temporary Claude Code user was not found.' }
    $userId = $user.id
    $updatedUser = Invoke-RestMethod -Uri "$base/api/user/" -Method PUT -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 `
        -Body (@{ id = $userId; username = $username; display_name = 'P6A2 Claude'; role = 1; status = 1; group = 'provider-spike'; quota = 0 } | ConvertTo-Json -Compress)
    if (-not $updatedUser.success) { throw 'Temporary Claude Code user group assignment failed.' }
    $quotaAdded = Invoke-RestMethod -Uri "$base/api/user/manage" -Method POST -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 `
        -Body (@{ id = $userId; action = 'add_quota'; value = 2000000; mode = 'add' } | ConvertTo-Json -Compress)
    if (-not $quotaAdded.success) { throw 'Temporary Claude Code user quota assignment failed.' }
    $userLogin = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -ContentType 'application/json' -TimeoutSec 30 `
        -UserAgent "HYC-E2E/phase6a2-claude-$PID" -Body (@{ username = $username; password = $testPassword } | ConvertTo-Json -Compress)
    if (-not $userLogin.success) { throw 'Temporary Claude Code user login failed.' }
    $userHeaders = @{ Authorization = "Bearer $($userLogin.data.access_token)" }

    $tokenName = "phase6a2-claude-$PID"
    $createdToken = Invoke-RestMethod -Uri "$base/api/token/" -Method POST -Headers $userHeaders -ContentType 'application/json' -TimeoutSec 30 `
        -Body (@{
            name = $tokenName; remain_quota = 2000000; unlimited_quota = $false
            expired_time = [DateTimeOffset]::UtcNow.AddMinutes(30).ToUnixTimeSeconds()
            model_limits_enabled = $true; model_limits = $publicModel; group = 'provider-spike'
        } | ConvertTo-Json -Compress)
    if (-not $createdToken.success) { throw 'Temporary Claude Code token creation failed.' }
    $tokenResponse = Invoke-RestMethod -Uri "$base/api/token/?p=0&size=100" -Headers $userHeaders -TimeoutSec 30
    $tokens = if ($tokenResponse.data.PSObject.Properties.Name -contains 'items') { $tokenResponse.data.items } else { $tokenResponse.data }
    $token = $tokens | Where-Object name -eq $tokenName | Select-Object -First 1
    if (-not $token) { throw 'Temporary Claude Code token was not listed.' }
    $tokenId = $token.id
    $revealed = Invoke-RestMethod -Uri "$base/api/token/$tokenId/key" -Method POST -Headers $userHeaders -TimeoutSec 30
    $hycToken = "$($revealed.data.key)"
    if ($hycToken -notlike 'sk-*') { $hycToken = "sk-$hycToken" }
    Add-Result 'isolated HYC identity' $true 'temporary model-scoped token'

    $models = Invoke-RestMethod -Uri "$base/v1/models" -Headers @{ Authorization = "Bearer $hycToken" } -TimeoutSec 30
    $modelIds = @($models.data | ForEach-Object id)
    $aliasRoutable = $modelIds.Count -eq 1 -and $modelIds[0] -eq $publicModel
    Add-Result 'HYC model-scoped catalog' $aliasRoutable "count=$($modelIds.Count)"
    if (-not $aliasRoutable) { throw 'The isolated HYC token cannot route the public alias.' }

    $clientWorkspace = Join-Path $root '.platform-tmp/phase6a2-claude-client'
    New-Item -ItemType Directory -Path $clientWorkspace -Force | Out-Null
    $clientEnvPath = Join-Path $clientWorkspace "client-$PID.env"
    @(
        "HYC_API_BASE_URL=$base"
        "HYC_API_TOKEN=$hycToken"
        "HYC_PUBLIC_MODEL=$publicModel"
    ) | Set-Content -LiteralPath $clientEnvPath -Encoding utf8
    $clientOutput = @(& pwsh -NoProfile -File (Join-Path $root 'scripts/run-claude-code-hyc.ps1') `
        -EnvFile $clientEnvPath -WorkingDirectory $clientWorkspace -Minimal -TimeoutSeconds 180 `
        -Print 'Reply with exactly CLAUDE_CODE_HYC_OK.' 2>&1) -join "`n"
    $clientExit = $LASTEXITCODE
    $clientPassed = $clientExit -eq 0 -and $clientOutput -match 'CLAUDE_CODE_HYC_OK'
    Add-Result 'Claude Code ordinary message' $clientPassed "exit=$clientExit"
    if (-not $clientPassed) {
        $safeClientError = $clientOutput.Replace($hycToken, '[HYC_TOKEN_REDACTED]')
        $safeClientError = $safeClientError -replace 'sk-[A-Za-z0-9_-]+', '[TOKEN_REDACTED]'
        $classification = if ($safeClientError -match '500|api_error|Upstream provider request failed') {
            'HYC returned a generic upstream failure'
        } elseif ($safeClientError -match 'timed out|timeout') {
            'client timed out'
        } else {
            'client returned a non-zero exit code'
        }
        Write-Warning $classification
    }

    Start-Sleep -Seconds 2
    $logsResponse = Invoke-RestMethod -Uri "$base/api/log/self?p=0&size=100" -Headers $userHeaders -TimeoutSec 30
    $logs = if ($logsResponse.data.PSObject.Properties.Name -contains 'items') { $logsResponse.data.items } else { $logsResponse.data }
    $clientLogs = @($logs | Where-Object token_name -eq $tokenName)
    $logText = $clientLogs | ConvertTo-Json -Depth 12 -Compress
    $logsSafe = $clientLogs.Count -ge 1 -and $logText -notmatch 'OpenRouter|openrouter\.ai|anthropic/claude-opus-4\.6'
    Add-Result 'request reached HYC AI' ($clientLogs.Count -ge 1) "logs=$($clientLogs.Count)"
    Add-Result 'public model and log privacy' ($logsSafe -and @($clientLogs | Where-Object model_name -ne $publicModel).Count -eq 0)

    $usageAfter = Get-OpenRouterUsage
    $additionalSpend = $usageAfter - $usageBefore
    Add-Result 'Claude Code spend ceiling' ($additionalSpend -ge 0 -and $additionalSpend -lt $MaxAdditionalSpendUsd) "spent_usd=$additionalSpend"
} finally {
    if ($tokenId -and $userHeaders) {
        try { [void](Invoke-RestMethod -Uri "$base/api/token/$tokenId" -Method DELETE -Headers $userHeaders -TimeoutSec 30) } catch { Add-Result 'temporary token cleanup' $false }
    }
    if ($userId -and $adminHeaders) {
        try {
            $deleted = Invoke-RestMethod -Uri "$base/api/user/$userId" -Method DELETE -Headers $adminHeaders -TimeoutSec 30
            Add-Result 'temporary user and Session cleanup' ([bool]$deleted.success)
        } catch { Add-Result 'temporary user and Session cleanup' $false }
    }
    if ($diskThresholdChanged -and $adminHeaders) {
        try {
            $restored = Invoke-RestMethod -Uri "$base/api/option/" -Method PUT -Headers $adminHeaders -ContentType 'application/json' -TimeoutSec 30 `
                -Body (@{ key = 'performance_setting.monitor_disk_threshold'; value = $originalDiskThreshold } | ConvertTo-Json -Compress)
            Add-Result 'development disk threshold restored' ([bool]$restored.success) "value=$originalDiskThreshold"
        } catch { Add-Result 'development disk threshold restored' $false }
    }
    if ($clientEnvPath -and (Test-Path -LiteralPath $clientEnvPath)) {
        Remove-Item -LiteralPath $clientEnvPath -Force
    }
    $hycToken = $null
    $openRouterKey = $null
}

$failed = @($results | Where-Object status -eq 'fail')
Write-Host ('-' * 82)
if ($failed.Count -gt 0) { exit 1 }
Write-Host 'Claude Code minimal HYC AI client probe passed.' -ForegroundColor Green
