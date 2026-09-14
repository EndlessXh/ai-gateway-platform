<#
.SYNOPSIS
    Builds and runs the Go API server against the local development stack.

.DESCRIPTION
    Reads deploy/.env.dev, derives SQL_DSN / REDIS_CONN_STRING from the same
    values the containers were started with, and runs the API on the host.

    Secrets are passed via the process environment only. They are never
    written to disk, echoed, or placed on the command line (where they would
    be visible to any other process listing the process table).

    The Go binary embeds web/dist, so the frontend must be built at least once
    before this will produce a usable UI:
        pwsh ./scripts/build-web.ps1

.PARAMETER SkipBuild
    Run the previously built binary instead of recompiling.

.PARAMETER AllowLan
    Bind all interfaces instead of loopback only, making the dev server
    reachable from the local network. Off by default: the admin UI and the
    relay API should not be exposed to an untrusted network by accident.
    Use only when you actually need to test from another device.

.EXAMPLE
    pwsh ./scripts/dev-backend.ps1
    pwsh ./scripts/dev-backend.ps1 -AllowLan   # explicitly expose to the LAN
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [switch] $SkipBuild,
    [switch] $AllowLan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Env file not found: $envPath`nRun: pwsh ./scripts/new-secrets.ps1"
}
Assert-NoPlaceholders -Path $envPath

$map = Read-EnvFile -Path $envPath
$distIndex = Join-Path $root 'web/dist/index.html'
if (-not (Test-Path -LiteralPath $distIndex)) {
    throw "web/dist is missing. The Go binary embeds it, so build the frontend first:`n  pwsh ./scripts/build-web.ps1"
}

$binDir = Join-Path $root '.platform-tmp'
$bin = Join-Path $binDir 'ai-gateway.exe'

if (-not $SkipBuild) {
    if (-not (Test-Path -LiteralPath $binDir)) { New-Item -ItemType Directory -Force -Path $binDir | Out-Null }
    Write-Host "Building Go backend..." -ForegroundColor Cyan
    Push-Location $root
    try {
        # Module path is github.com/QuantumNous/new-api, so the version symbol
        # lives at <module>/common.Version. A wrong -X path is silently ignored
        # by the linker, which is why it is spelled out explicitly here.
        $version = 'v1.0.0-rc.22-platform'
        & go build -o $bin -ldflags "-X 'github.com/QuantumNous/new-api/common.Version=$version'" .
        if ($LASTEXITCODE -ne 0) { throw "go build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    Write-Host "Built: $bin" -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $bin)) {
    throw "Binary not found: $bin (run without -SkipBuild)"
}

$pgPort = $map['PLATFORM_POSTGRES_HOST_PORT']
$rdPort = $map['PLATFORM_REDIS_HOST_PORT']

# Connect over the published loopback ports; the containers are not on the
# host network. sslmode=disable is correct for a loopback dev container.
$env:SQL_DSN = "postgresql://$($map['POSTGRES_USER']):$($map['POSTGRES_PASSWORD'])@127.0.0.1:$pgPort/$($map['POSTGRES_DB'])?sslmode=disable"
$env:REDIS_CONN_STRING = "redis://:$($map['REDIS_PASSWORD'])@127.0.0.1:$rdPort/0"

$env:PORT = $map['PLATFORM_HTTP_PORT']
$env:SESSION_SECRET = $map['SESSION_SECRET']
$env:CRYPTO_SECRET = $map['CRYPTO_SECRET']
$env:GIN_MODE = $map['GIN_MODE']
$env:DEBUG = $map['DEBUG']
$env:ENABLE_PPROF = $map['ENABLE_PPROF']
$env:ERROR_LOG_ENABLED = $map['ERROR_LOG_ENABLED']
$env:TLS_INSECURE_SKIP_VERIFY = $map['TLS_INSECURE_SKIP_VERIFY']
$env:GENERATE_DEFAULT_TOKEN = $map['GENERATE_DEFAULT_TOKEN']
$env:STREAMING_TIMEOUT = $map['STREAMING_TIMEOUT']
$env:MEMORY_CACHE_ENABLED = $map['MEMORY_CACHE_ENABLED']
$env:BATCH_UPDATE_ENABLED = $map['BATCH_UPDATE_ENABLED']
$env:BATCH_UPDATE_INTERVAL = $map['BATCH_UPDATE_INTERVAL']
$env:SESSION_COOKIE_SECURE = $map['SESSION_COOKIE_SECURE']
$env:TRUSTED_PROXIES = $map['TRUSTED_PROXIES']
$env:GLOBAL_API_RATE_LIMIT_ENABLE = $map['GLOBAL_API_RATE_LIMIT_ENABLE']
$env:GLOBAL_WEB_RATE_LIMIT_ENABLE = $map['GLOBAL_WEB_RATE_LIMIT_ENABLE']
$env:CRITICAL_RATE_LIMIT_ENABLE = $map['CRITICAL_RATE_LIMIT_ENABLE']
$env:NODE_NAME = $map['NODE_NAME']
$env:NODE_TYPE = $map['NODE_TYPE']
$env:TZ = $map['TZ']
$env:PLATFORM_BRAND_NAME = if ($map.Contains('PLATFORM_BRAND_NAME') -and $map['PLATFORM_BRAND_NAME']) { $map['PLATFORM_BRAND_NAME'] } else { 'HYC AI' }

# Loopback by default. Running the binary on the host with an empty bind
# address would publish the admin UI and relay API to every interface,
# including the LAN. See BIND_ADDRESS in main.go.
if ($AllowLan) {
    $env:BIND_ADDRESS = ''
} else {
    $env:BIND_ADDRESS = '127.0.0.1'
}

Write-Host ""
Write-Host "Starting API on http://127.0.0.1:$($env:PORT)" -ForegroundColor Green
Write-Host "  postgres 127.0.0.1:$pgPort/$($map['POSTGRES_DB'])   redis 127.0.0.1:$rdPort" -ForegroundColor DarkGray
if ($AllowLan) {
    Write-Host "  WARNING: -AllowLan is set. This is reachable from your local network." -ForegroundColor Red
} else {
    Write-Host "  Bound to 127.0.0.1 only. Use -AllowLan if you need LAN access." -ForegroundColor DarkGray
}
Write-Host "  Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

& $bin --log-dir (Join-Path $root '.platform-tmp/logs')
