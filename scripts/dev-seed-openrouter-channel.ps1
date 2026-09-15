<#
.SYNOPSIS
    Creates the single isolated OpenRouter development route for Phase 6A.

.DESCRIPTION
    Reads OPENROUTER_API_KEY from the Git-ignored local environment file,
    authenticates to the loopback development API, and idempotently creates
    one provider-spike channel plus its public catalog alias. The secret is
    retained in process memory only and is never printed.
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [string] $OpenRouterEnvFile,
    [string] $ChannelName = 'openrouter-claude-opus-4-6-dev'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
$platformEnv = Read-EnvFile -Path $envPath
$base = "http://$($platformEnv['PLATFORM_HTTP_HOST']):$($platformEnv['PLATFORM_HTTP_PORT'])"

if (-not $OpenRouterEnvFile) {
    $OpenRouterEnvFile = Join-Path $root 'deploy/.env.openrouter.local'
}
if (-not (Test-Path -LiteralPath $OpenRouterEnvFile)) {
    throw 'OpenRouter local environment file is missing.'
}
$providerEnv = Read-EnvFile -Path $OpenRouterEnvFile
$upstreamKey = if ($providerEnv.Contains('OPENROUTER_API_KEY')) { "$($providerEnv['OPENROUTER_API_KEY'])".Trim() } else { '' }
if (-not $upstreamKey) {
    throw 'OPENROUTER_API_KEY is missing or empty.'
}
Write-Host 'OPENROUTER_API_KEY: present' -ForegroundColor DarkGray

$openRouterUri = [Uri]'https://openrouter.ai'
$resolvedProxy = [Net.WebRequest]::DefaultWebProxy.GetProxy($openRouterUri)
$proxyUrl = if (-not [Net.WebRequest]::DefaultWebProxy.IsBypassed($openRouterUri) -and $resolvedProxy.AbsoluteUri -ne $openRouterUri.AbsoluteUri) {
    $resolvedProxy.AbsoluteUri
} else {
    ''
}
$channelSetting = @{ proxy = $proxyUrl } | ConvertTo-Json -Compress
Write-Host "Windows system proxy: $(if ($proxyUrl) { 'detected (address suppressed)' } else { 'direct' })" -ForegroundColor DarkGray

$credFile = Join-Path $root '.platform-tmp/dev-admin-credentials.txt'
if (-not (Test-Path -LiteralPath $credFile)) {
    throw "Admin credentials not found at $credFile. Complete development setup first."
}
$password = ((Get-Content -LiteralPath $credFile | Where-Object { $_ -like 'password: *' }) -replace '^password: ', '')
$loginBody = @{ username = 'root'; password = $password } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -Body $loginBody -ContentType 'application/json' -TimeoutSec 30
if (-not $login.success) { throw "Login failed: $($login.message)" }
$headers = @{ Authorization = "Bearer $($login.data.access_token)" }

$publicModel = 'claude-opus-4.6'
$upstreamModel = 'anthropic/claude-opus-4.6'
$modelMapping = [ordered]@{ $publicModel = $upstreamModel } | ConvertTo-Json -Compress
$channelData = @{
    name = $ChannelName
    type = 20
    key = $upstreamKey
    base_url = 'https://openrouter.ai/api'
    models = $publicModel
    model_mapping = $modelMapping
    group = 'provider-spike'
    status = 1
    setting = $channelSetting
}
$channelPayload = @{ mode = 'single'; channel = $channelData } | ConvertTo-Json -Depth 5

$existingResponse = Invoke-RestMethod -Uri "$base/api/channel/?p=0&page_size=100" -Headers $headers -TimeoutSec 30
$existingItems = if ($existingResponse.data -and $existingResponse.data.PSObject.Properties.Name -contains 'items') { @($existingResponse.data.items) } else { @($existingResponse.data) }
$matches = @($existingItems | Where-Object { $_.name -eq $ChannelName })
if ($matches.Count -gt 1) {
    throw "Expected one channel named '$ChannelName', found $($matches.Count)."
}
if ($matches.Count -eq 1) {
    $channel = $matches[0]
    if ([int]$channel.type -ne 20 -or $channel.base_url -ne 'https://openrouter.ai/api' -or $channel.models -ne $publicModel -or $channel.group -ne 'provider-spike' -or $channel.model_mapping -ne $modelMapping) {
        throw "Existing channel '$ChannelName' does not match the Phase 6A configuration."
    }
    if ($channel.setting -ne $channelSetting) {
        $updateData = @{
            id = $channel.id
            name = $ChannelName
            type = 20
            key = $upstreamKey
            base_url = 'https://openrouter.ai/api'
            models = $publicModel
            model_mapping = $modelMapping
            group = 'provider-spike'
            setting = $channelSetting
        } | ConvertTo-Json -Depth 5
        $updated = Invoke-RestMethod -Uri "$base/api/channel/" -Method PUT -Body $updateData -ContentType 'application/json' -Headers $headers -TimeoutSec 60
        if (-not $updated.success) { throw "Channel proxy update failed: $($updated.message)" }
        Write-Host "Channel '$ChannelName' proxy setting synchronized." -ForegroundColor Green
    } else {
        Write-Host "Channel '$ChannelName' already exists and matches; preserving it." -ForegroundColor Yellow
    }
} else {
    $created = Invoke-RestMethod -Uri "$base/api/channel/" -Method POST -Body $channelPayload -ContentType 'application/json' -Headers $headers -TimeoutSec 60
    if (-not $created.success) { throw "Channel creation failed: $($created.message)" }
    Write-Host "Channel '$ChannelName' created in provider-spike." -ForegroundColor Green
}

# The alias needs an internal development ratio to pass the billing guard.
# These values are provisional test inputs, not an approved or published price.
$options = Invoke-RestMethod -Uri "$base/api/option/" -Headers $headers -TimeoutSec 30
if (-not $options.success) { throw "Could not read options: $($options.message)" }

function Merge-RatioOption {
    param([string] $Key, [hashtable] $Additions)
    $current = ($options.data | Where-Object { $_.key -eq $Key } | Select-Object -First 1).value
    $merged = [ordered]@{}
    if ($current) {
        $existing = $current | ConvertFrom-Json
        foreach ($property in $existing.PSObject.Properties) { $merged[$property.Name] = $property.Value }
    }
    foreach ($name in $Additions.Keys) { $merged[$name] = $Additions[$name] }
    $body = @{ key = $Key; value = ($merged | ConvertTo-Json -Compress -Depth 5) } | ConvertTo-Json -Depth 5
    $response = Invoke-RestMethod -Uri "$base/api/option/" -Method PUT -Body $body -ContentType 'application/json' -Headers $headers -TimeoutSec 30
    if (-not $response.success) { throw "Failed to update ${Key}: $($response.message)" }
}

Merge-RatioOption -Key 'ModelRatio' -Additions @{ $publicModel = 2.5 }
Merge-RatioOption -Key 'CompletionRatio' -Additions @{ $publicModel = 5.0 }
Merge-RatioOption -Key 'CacheRatio' -Additions @{ $publicModel = 0.1 }
Merge-RatioOption -Key 'CreateCacheRatio' -Additions @{ $publicModel = 1.25 }
Merge-RatioOption -Key 'GroupRatio' -Additions @{ 'provider-spike' = 1.0 }
Write-Host 'Provisional development billing ratios configured; PRICING_STATUS remains provisional.' -ForegroundColor Yellow

$catalogResponse = Invoke-RestMethod -Uri "$base/api/platform/admin/models" -Headers $headers -TimeoutSec 30
if (-not $catalogResponse.success) { throw "Could not read model catalog: $($catalogResponse.message)" }
$catalogMatches = @($catalogResponse.data | Where-Object { $_.public_model_id -eq $publicModel })
if ($catalogMatches.Count -gt 1) { throw "Duplicate catalog entries found for '$publicModel'." }
if ($catalogMatches.Count -eq 0) {
    $catalogPayload = [ordered]@{
        public_model_id = $publicModel
        display_name = 'Claude Opus 4.6'
        provider_key = 'platform'
        provider_label = 'HYC AI'
        description_en = 'A high-capability HYC AI model for chat, tools, and reasoning.'
        description_zh_cn = '面向对话、工具调用与推理任务的 HYC AI 高能力模型。'
        category = 'reasoning'
        capabilities = @('chat', 'streaming', 'reasoning', 'tools')
        input_modalities = @('text', 'image')
        output_modalities = @('text')
        context_label = ''
        icon_key = 'brain'
        badge_key = 'preview'
        availability_status = 'preview'
        visibility = 'public'
        show_in_pricing = $true
        show_in_playground = $true
        api_enabled = $true
        recommended = $true
        sort_order = 5
    } | ConvertTo-Json -Depth 6
    $catalogCreated = Invoke-RestMethod -Uri "$base/api/platform/admin/models" -Method POST -Body $catalogPayload -ContentType 'application/json' -Headers $headers -TimeoutSec 30
    if (-not $catalogCreated.success) { throw "Could not create catalog alias: $($catalogCreated.message)" }
    Write-Host "Catalog alias '$publicModel' created." -ForegroundColor Green
} else {
    Write-Host "Catalog alias '$publicModel' already exists; preserving administrator changes." -ForegroundColor Yellow
}

Write-Host "Model mapping verified: $publicModel -> $upstreamModel" -ForegroundColor DarkGray
Write-Host 'The OpenRouter key was not printed or written by this script.' -ForegroundColor DarkGray
