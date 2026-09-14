<#
.SYNOPSIS
    Seeds the development product model catalog with neutral platform aliases.

.DESCRIPTION
    This explicit development-only seed calls the authenticated local admin API.
    It does not run during production startup, write pricing, create channels, or
    store credentials in the repository. Existing catalog entries are preserved
    so administrator edits are never overwritten by a repeated seed.
#>
[CmdletBinding()]
param([string] $EnvFile)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
$map = Read-EnvFile -Path $envPath
$base = "http://$($map['PLATFORM_HTTP_HOST']):$($map['PLATFORM_HTTP_PORT'])"
$credFile = Join-Path $root '.platform-tmp/dev-admin-credentials.txt'
if (-not (Test-Path -LiteralPath $credFile)) {
    throw "Admin credentials not found at $credFile. Complete development setup first."
}

$password = ((Get-Content -LiteralPath $credFile | Where-Object { $_ -like 'password: *' }) -replace '^password: ', '')
$loginBody = @{ username = 'root'; password = $password } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -Body $loginBody -ContentType 'application/json' -TimeoutSec 30
if (-not $login.success) { throw "Login failed: $($login.message)" }
$headers = @{ Authorization = "Bearer $($login.data.access_token)" }

$catalog = @(
    [ordered]@{
        public_model_id = 'platform-general-preview'
        display_name = 'Platform General Preview'
        provider_key = 'platform'
        provider_label = 'Platform routing'
        description_en = 'A neutral platform alias for general text generation. Its underlying route may change without changing the public model ID.'
        description_zh_cn = '面向通用文本生成的中性平台别名。底层路由可调整，而公开模型 ID 保持不变。'
        category = 'general'
        capabilities = @('chat', 'streaming')
        input_modalities = @('text')
        output_modalities = @('text')
        context_label = ''
        icon_key = 'platform'
        badge_key = 'preview'
        availability_status = 'preview'
        visibility = 'public'
        show_in_pricing = $true
        show_in_playground = $true
        api_enabled = $true
        recommended = $true
        sort_order = 10
    },
    [ordered]@{
        public_model_id = 'platform-reasoning-preview'
        display_name = 'Platform Reasoning Preview'
        provider_key = 'platform'
        provider_label = 'Platform routing'
        description_en = 'A neutral platform alias for text tasks that benefit from reasoning. Its underlying route may change without changing the public model ID.'
        description_zh_cn = '面向需要推理能力的文本任务的中性平台别名。底层路由可调整，而公开模型 ID 保持不变。'
        category = 'reasoning'
        capabilities = @('chat', 'streaming', 'reasoning')
        input_modalities = @('text')
        output_modalities = @('text')
        context_label = ''
        icon_key = 'brain'
        badge_key = 'preview'
        availability_status = 'preview'
        visibility = 'public'
        show_in_pricing = $true
        show_in_playground = $true
        api_enabled = $true
        recommended = $false
        sort_order = 20
    }
)

$existingResponse = Invoke-RestMethod -Uri "$base/api/platform/admin/models" -Headers $headers -TimeoutSec 30
if (-not $existingResponse.success) { throw "Could not read model catalog: $($existingResponse.message)" }
$existingIDs = @($existingResponse.data | ForEach-Object { $_.public_model_id })

foreach ($entry in $catalog) {
    if ($existingIDs -contains $entry.public_model_id) {
        Write-Host "Model '$($entry.public_model_id)' already exists; preserving administrator changes." -ForegroundColor Yellow
        continue
    }
    $body = $entry | ConvertTo-Json -Depth 6
    $response = Invoke-RestMethod -Uri "$base/api/platform/admin/models" -Method POST -Body $body -ContentType 'application/json' -Headers $headers -TimeoutSec 30
    if (-not $response.success) { throw "Could not seed '$($entry.public_model_id)': $($response.message)" }
    Write-Host "Model '$($entry.public_model_id)' created." -ForegroundColor Green
}

Write-Host 'Development model catalog seed complete. No channels, prices, or credentials were written.' -ForegroundColor DarkGray
