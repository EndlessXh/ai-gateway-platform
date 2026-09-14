<#
.SYNOPSIS
    Applies the development product name through the authenticated option API.

.DESCRIPTION
    Idempotently stores SystemName in the development database. This keeps the
    administrator override aligned with PLATFORM_BRAND_NAME without requiring
    a manual visit to the system settings screen.
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [string] $BrandName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
$map = Read-EnvFile -Path $envPath
$base = "http://$($map['PLATFORM_HTTP_HOST']):$($map['PLATFORM_HTTP_PORT'])"
$resolvedBrand = if ($BrandName) { $BrandName.Trim() } elseif ($map.Contains('PLATFORM_BRAND_NAME')) { $map['PLATFORM_BRAND_NAME'].Trim() } else { 'HYC AI' }
if (-not $resolvedBrand) { throw 'Brand name must not be empty.' }

$credFile = Join-Path $root '.platform-tmp/dev-admin-credentials.txt'
if (-not (Test-Path -LiteralPath $credFile)) {
    throw "Admin credentials not found at $credFile. Complete setup first."
}
$password = ((Get-Content -LiteralPath $credFile | Where-Object { $_ -like 'password: *' }) -replace '^password: ', '')
$loginBody = @{ username = 'root'; password = $password } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$base/api/user/login" -Method POST -Body $loginBody -ContentType 'application/json' -TimeoutSec 30
if (-not $login.success) { throw "Login failed: $($login.message)" }

$headers = @{ Authorization = "Bearer $($login.data.access_token)" }
$body = @{ key = 'SystemName'; value = $resolvedBrand } | ConvertTo-Json
$response = Invoke-RestMethod -Uri "$base/api/option/" -Method PUT -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30
if (-not $response.success) { throw "Brand seed failed: $($response.message)" }

Write-Host "Development SystemName set to '$resolvedBrand'." -ForegroundColor Green
