<#
.SYNOPSIS
    Starts the local development backing services (PostgreSQL 16 + Redis 7).

.DESCRIPTION
    Brings up the `ai-gateway-dev` Compose project and waits for both services
    to report healthy. The Go backend and the Rsbuild dev server are run
    natively on the host (see scripts/dev-backend.ps1), not in containers.

    This stack is fully isolated from the ../new-api-infra `new-api-dev` stack:
    different project name, volumes and host ports. It cannot touch that data.

.PARAMETER App
    Also build and run the containerised application (Compose profile `app`),
    used to verify the production image builds.

.EXAMPLE
    pwsh ./scripts/dev-up.ps1
    pwsh ./scripts/dev-up.ps1 -App
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [switch] $App,
    [int] $HealthTimeoutSec = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

if ($HealthTimeoutSec -lt 30) { $HealthTimeoutSec = 30 }

Assert-DockerEngine

$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Env file not found: $envPath`nRun: pwsh ./scripts/new-secrets.ps1"
}
Assert-NoPlaceholders -Path $envPath

$composeArgs = Get-ComposeArgs -EnvFilePath $envPath -Environment 'dev'
$project = Get-ProjectName -EnvFilePath $envPath

Write-Host "Project : $project" -ForegroundColor Cyan
Write-Host "Env file: $envPath" -ForegroundColor Cyan

# Validate the merged config before touching any containers, so a typo fails
# here rather than half-way through a partial start.
$null = Invoke-Compose -ComposeArgs $composeArgs -Command @('config', '--quiet')
if ($LASTEXITCODE -ne 0) { throw "docker compose config failed; fix the compose/env files before starting." }

# Fail early on unbindable host ports. Windows/Hyper-V reserves large TCP
# ranges, and binding inside one fails with a confusing "access permissions"
# error from the daemon halfway through `up` rather than a clear message.
$map = Read-EnvFile -Path $envPath
$wanted = @{
    'postgres' = $map['PLATFORM_POSTGRES_HOST_PORT']
    'redis'    = $map['PLATFORM_REDIS_HOST_PORT']
}
if ($App) { $wanted['app'] = $map['PLATFORM_HTTP_PORT'] }

foreach ($svc in $wanted.Keys) {
    $port = [int]$wanted[$svc]
    $cid = (& docker @($composeArgs + @('ps', '-q', $svc)) 2>$null | Select-Object -First 1)
    # A port held by our own already-running container is fine.
    if ($cid) { continue }
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
        $listener.Start()
        $listener.Stop()
    } catch {
        throw @"
Host port $port ($svc) cannot be bound: $($_.Exception.Message)

If this says "access permissions", the port is inside a Windows reserved
range rather than in use. List them with:
    netsh interface ipv4 show excludedportrange protocol=tcp
Then pick a free port and update the PLATFORM_*_HOST_PORT entry for '$svc' in:
    $envPath
"@
    }
}

$services = @('postgres', 'redis')
if ($App) { $services += 'app' }

$upCmd = @('up', '-d', '--remove-orphans')
if ($App) { $upCmd = @('--profile', 'app') + $upCmd }
$code = Invoke-Compose -ComposeArgs $composeArgs -Command ($upCmd + $services)
if ($code -ne 0) { throw "docker compose up failed with exit code $code" }

Write-Host ""
Write-Host "Waiting for health (timeout ${HealthTimeoutSec}s)..." -ForegroundColor Cyan

$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    $states = @()
    foreach ($svc in $services) {
        $cid = (& docker @($composeArgs + @('ps', '-q', $svc)) 2>$null | Select-Object -First 1)
        if (-not $cid) { $states += "$svc=missing"; continue }
        $st = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $cid 2>$null)
        $states += "$svc=$st"
    }
    if (@($states | Where-Object { $_ -notmatch '=(healthy|running)$' }).Count -eq 0) {
        $healthy = $true
        Write-Host ("  " + ($states -join '  ')) -ForegroundColor Green
        break
    }
    Write-Host ("  " + ($states -join '  ')) -ForegroundColor DarkGray
    Start-Sleep -Seconds 3
}

if (-not $healthy) {
    Write-Host ""
    Write-Host "Services did not become healthy within ${HealthTimeoutSec}s." -ForegroundColor Red
    $null = Invoke-Compose -ComposeArgs $composeArgs -Command @('ps')
    foreach ($svc in $services) {
        Write-Host "--- last 60 log lines: $svc ---" -ForegroundColor Yellow
        $null = Invoke-Compose -ComposeArgs $composeArgs -Command @('logs', '--tail', '60', $svc)
    }
    exit 1
}

$map = Read-EnvFile -Path $envPath
Write-Host ""
Write-Host "Backing services are up." -ForegroundColor Green
Write-Host "  postgres : 127.0.0.1:$($map['PLATFORM_POSTGRES_HOST_PORT'])  db=$($map['POSTGRES_DB']) user=$($map['POSTGRES_USER'])"
Write-Host "  redis    : 127.0.0.1:$($map['PLATFORM_REDIS_HOST_PORT'])"
if ($App) {
    Write-Host "  app      : http://$($map['PLATFORM_HTTP_HOST']):$($map['PLATFORM_HTTP_PORT'])"
} else {
    Write-Host "Next: pwsh ./scripts/dev-backend.ps1    (runs the Go API on the host)"
}
