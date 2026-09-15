<#
.SYNOPSIS
    Seeds the development database with an upstream provider channel exposed
    under neutral platform model aliases.

.DESCRIPTION
    Implements the provider-decoupling rule: the model names users see are
    platform-owned aliases, and the mapping to a concrete upstream model lives
    only in the channel's model_mapping. Swapping providers later is a channel
    change, not a user-visible change.

        platform-general-preview    -> <upstream general model>
        platform-reasoning-preview  -> <upstream reasoning model>

    The upstream API key is read from the existing new-api-infra baseline
    database (-FromBaseline) or supplied interactively. It is held only in
    memory and POSTed to the local admin API. It is never written to the
    repository, echoed to the console, or placed on a command line.

    NOTE: these aliases are deliberately vendor-neutral. Do not label a
    channel with a vendor name it is not actually routing to.

.EXAMPLE
    pwsh ./scripts/dev-seed-channel.ps1 -FromBaseline
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [switch] $FromBaseline,
    [string] $BaselineContainer = 'new-api-dev-postgres-1',
    [int]    $BaselineChannelId = 1,
    [string] $ChannelName = 'upstream-a-dev',
    [string] $GeneralUpstreamModel = 'qwen-plus',
    [string] $ReasoningUpstreamModel = 'qwen3.7-plus'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
$map = Read-EnvFile -Path $envPath
$base = "http://$($map['PLATFORM_HTTP_HOST']):$($map['PLATFORM_HTTP_PORT'])"

# --- Obtain the upstream key -------------------------------------------------
$upstreamKey = $null
$baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode'

if ($FromBaseline) {
    Write-Host "Reading upstream key from baseline container '$BaselineContainer' (channel $BaselineChannelId)..." -ForegroundColor Cyan
    $upstreamKey = (& docker exec $BaselineContainer sh -c "psql -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -tAc `"select key from channels where id=$BaselineChannelId;`"" 2>$null)
    $upstreamKey = "$upstreamKey".Trim()
    $fetched = (& docker exec $BaselineContainer sh -c "psql -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -tAc `"select base_url from channels where id=$BaselineChannelId;`"" 2>$null)
    if ("$fetched".Trim()) { $baseUrl = "$fetched".Trim() }
    if (-not $upstreamKey) { throw "Could not read a key from baseline channel $BaselineChannelId." }
    Write-Host "  key obtained (length $($upstreamKey.Length)); value not displayed." -ForegroundColor DarkGray
} else {
    $secure = Read-Host -AsSecureString "Upstream API key"
    $upstreamKey = [System.Net.NetworkCredential]::new('', $secure).Password
    if (-not $upstreamKey) { throw "No key supplied." }
}

# --- Authenticate against the local admin API --------------------------------
$credFile = Join-Path $root '.platform-tmp/dev-admin-credentials.txt'
if (-not (Test-Path -LiteralPath $credFile)) {
    throw "Admin credentials not found at $credFile. Complete setup first."
}
$pw = ((Get-Content -LiteralPath $credFile | Where-Object { $_ -like 'password: *' }) -replace '^password: ', '')
$loginBody = @{ username = 'root'; password = $pw } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -Body $loginBody -ContentType 'application/json' -TimeoutSec 30
if (-not $login.success) { throw "Login failed: $($login.message)" }
$headers = @{ Authorization = "Bearer $($login.data.access_token)" }

# --- Create the channel ------------------------------------------------------
# type 1 = OpenAI-compatible. Bailian exposes an OpenAI-compatible endpoint.
$modelMapping = [ordered]@{
    'platform-general-preview'   = $GeneralUpstreamModel
    'platform-reasoning-preview' = $ReasoningUpstreamModel
} | ConvertTo-Json -Compress

$payload = @{
    mode    = 'single'
    channel = @{
        name          = $ChannelName
        type          = 1
        key           = $upstreamKey
        base_url      = $baseUrl
        models        = 'platform-general-preview,platform-reasoning-preview'
        model_mapping = $modelMapping
        group         = 'default'
        status        = 1
    }
} | ConvertTo-Json -Depth 5

# Idempotent: re-running must not pile up duplicate channels, which would
# silently spread load across identical entries and confuse routing.
$existingList = Invoke-RestMethod -Uri "$base/api/channel/?p=0&page_size=100" -Headers $headers -TimeoutSec 30
$existingItems = if ($existingList.data -and $existingList.data.PSObject.Properties.Name -contains 'items') { $existingList.data.items } else { $existingList.data }
$already = $existingItems | Where-Object { $_.name -eq $ChannelName } | Select-Object -First 1

if ($already) {
    Write-Host "Channel '$ChannelName' already exists (id $($already.id)); skipping creation." -ForegroundColor Yellow
} else {
    $resp = Invoke-RestMethod -Uri "$base/api/channel/" -Method POST -Body $payload -ContentType 'application/json' -Headers $headers -TimeoutSec 60
    if (-not $resp.success) { throw "Channel creation failed: $($resp.message)" }
    Write-Host "Channel '$ChannelName' created." -ForegroundColor Green
}

Write-Host "  public alias                 -> upstream model"
Write-Host "  platform-general-preview     -> $GeneralUpstreamModel"
Write-Host "  platform-reasoning-preview   -> $ReasoningUpstreamModel"
Write-Host ""
Write-Host "The upstream key was not written to disk." -ForegroundColor DarkGray

# --- Pricing for the platform aliases ----------------------------------------
# A model with no configured price is rejected by the billing layer, so the
# aliases need entries of their own — they are new names as far as pricing is
# concerned, and inherit nothing from the upstream model they map to.
#
# PROVISIONAL DEVELOPMENT PRICING. These are plausible values chosen so the
# billing path can be exercised end to end; they are NOT a commercial price
# list. Real pricing must be set deliberately before charging anyone.
# Convention: ModelRatio 1.0 == $0.002 / 1K prompt tokens.
# CompletionRatio multiplies the prompt ratio for output tokens.
$aliasModelRatio = @{
    'platform-general-preview'   = 0.2
    'platform-reasoning-preview' = 0.3
}
$aliasCompletionRatio = @{
    'platform-general-preview'   = 2.5
    'platform-reasoning-preview' = 3.0
}

$options = Invoke-RestMethod -Uri "$base/api/option/" -Headers $headers -TimeoutSec 30
if (-not $options.success) { throw "could not read options: $($options.message)" }

function Merge-RatioOption {
    param([string] $Key, [hashtable] $Additions)

    $current = ($options.data | Where-Object { $_.key -eq $Key } | Select-Object -First 1).value
    $merged = [ordered]@{}
    if ($current) {
        $existing = $current | ConvertFrom-Json
        foreach ($p in $existing.PSObject.Properties) { $merged[$p.Name] = $p.Value }
    }
    # Merge, never replace: the defaults carry pricing for hundreds of models.
    foreach ($k in $Additions.Keys) { $merged[$k] = $Additions[$k] }

    $body = @{ key = $Key; value = ($merged | ConvertTo-Json -Compress -Depth 5) } | ConvertTo-Json -Depth 5
    $r = Invoke-RestMethod -Uri "$base/api/option/" -Method PUT -Body $body -ContentType 'application/json' -Headers $headers -TimeoutSec 30
    if (-not $r.success) { throw "failed to update ${Key}: $($r.message)" }
    Write-Host "  $Key updated ($($merged.Keys.Count) models total)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Configuring provisional pricing for platform aliases..." -ForegroundColor Cyan
Merge-RatioOption -Key 'ModelRatio' -Additions $aliasModelRatio
Merge-RatioOption -Key 'CompletionRatio' -Additions $aliasCompletionRatio
Write-Host "Pricing configured. These are DEVELOPMENT placeholders, not commercial rates." -ForegroundColor Yellow
