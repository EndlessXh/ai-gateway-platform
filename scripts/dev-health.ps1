<#
.SYNOPSIS
    Reports the real health of the local development environment.

.DESCRIPTION
    Checks, and reports honestly on:
      - Docker engine reachability
      - container state for each service
      - a live PostgreSQL query (not just container status)
      - a live Redis PING
      - the backend /api/status endpoint, if the API is running

    Exits non-zero if any required check fails, so it is usable in CI or as a
    pre-flight gate.

.EXAMPLE
    pwsh ./scripts/dev-health.ps1
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [switch] $SkipApi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$failures = @()

function Write-Check {
    param([string] $Name, [bool] $Ok, [string] $Detail)
    $mark = if ($Ok) { '[ OK ]' } else { '[FAIL]' }
    $color = if ($Ok) { 'Green' } else { 'Red' }
    Write-Host ("{0} {1,-28} {2}" -f $mark, $Name, $Detail) -ForegroundColor $color
}

Write-Host "AI Gateway Platform - development health" -ForegroundColor Cyan
Write-Host ("-" * 72)

# --- Docker engine -----------------------------------------------------------
try {
    Assert-DockerEngine
    $ver = (& docker info --format '{{.ServerVersion}}' 2>$null)
    Write-Check -Name 'docker engine' -Ok $true -Detail "server $ver"
} catch {
    Write-Check -Name 'docker engine' -Ok $false -Detail $_.Exception.Message.Split("`n")[0]
    Write-Host ""
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    exit 1
}

$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
if (-not (Test-Path -LiteralPath $envPath)) {
    Write-Check -Name 'env file' -Ok $false -Detail "missing: $envPath"
    Write-Host "Run: pwsh ./scripts/new-secrets.ps1" -ForegroundColor Yellow
    exit 1
}
Write-Check -Name 'env file' -Ok $true -Detail $envPath

$map = Read-EnvFile -Path $envPath
$composeArgs = Get-ComposeArgs -EnvFilePath $envPath -Environment 'dev'

# --- Containers --------------------------------------------------------------
foreach ($svc in @('postgres', 'redis')) {
    $cid = (& docker @($composeArgs + @('ps', '-q', $svc)) 2>$null | Select-Object -First 1)
    if (-not $cid) {
        Write-Check -Name "container: $svc" -Ok $false -Detail 'not created (run dev-up.ps1)'
        $failures += $svc
        continue
    }
    $st = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $cid 2>$null)
    $ok = $st -match '^(healthy|running)$'
    Write-Check -Name "container: $svc" -Ok $ok -Detail $st
    if (-not $ok) { $failures += $svc }
}

# --- Live PostgreSQL query ---------------------------------------------------
$pgId = (& docker @($composeArgs + @('ps', '-q', 'postgres')) 2>$null | Select-Object -First 1)
if ($pgId) {
    $tables = (& docker exec $pgId sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from pg_tables where schemaname=''public'';"' 2>$null)
    if ($LASTEXITCODE -eq 0 -and "$tables".Trim() -match '^\d+$') {
        Write-Check -Name 'postgres query' -Ok $true -Detail "$($tables.Trim()) tables in public schema"
    } else {
        Write-Check -Name 'postgres query' -Ok $false -Detail 'query failed'
        $failures += 'postgres-query'
    }
}

# --- Live Redis PING ---------------------------------------------------------
$rdId = (& docker @($composeArgs + @('ps', '-q', 'redis')) 2>$null | Select-Object -First 1)
if ($rdId) {
    $pong = (& docker exec $rdId sh -c 'redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null' 2>$null)
    if ("$pong".Trim() -eq 'PONG') {
        Write-Check -Name 'redis ping' -Ok $true -Detail 'PONG'
    } else {
        Write-Check -Name 'redis ping' -Ok $false -Detail "got '$pong'"
        $failures += 'redis-ping'
    }
}

# --- Backend API -------------------------------------------------------------
if (-not $SkipApi) {
    $url = "http://$($map['PLATFORM_HTTP_HOST']):$($map['PLATFORM_HTTP_PORT'])/api/status"
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
        $ok = $resp.StatusCode -eq 200 -and $resp.Content -match '"success"'
        Write-Check -Name 'api /api/status' -Ok $ok -Detail "HTTP $($resp.StatusCode) @ $url"
        if (-not $ok) { $failures += 'api' }
    } catch {
        # Not a failure by itself: the API is run manually in dev.
        Write-Check -Name 'api /api/status' -Ok $false -Detail "not reachable @ $url (start it with dev-backend.ps1)"
    }
}

Write-Host ("-" * 72)
if ($failures.Count -gt 0) {
    Write-Host "FAILED: $($failures -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "Backing services healthy." -ForegroundColor Green
