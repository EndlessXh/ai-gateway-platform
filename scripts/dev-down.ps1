<#
.SYNOPSIS
    Stops the local development stack.

.DESCRIPTION
    By default this stops and removes containers but KEEPS the named volumes,
    so the development database survives a restart.

.PARAMETER DeleteData
    Also removes the named volumes. This destroys the development database
    (users, tokens, channels, logs) and cannot be undone. Requires typing the
    project name to confirm.

.EXAMPLE
    pwsh ./scripts/dev-down.ps1
    pwsh ./scripts/dev-down.ps1 -DeleteData
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [switch] $DeleteData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

Assert-DockerEngine

$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Env file not found: $envPath"
}

$composeArgs = Get-ComposeArgs -EnvFilePath $envPath -Environment 'dev'
$project = Get-ProjectName -EnvFilePath $envPath

if ($DeleteData) {
    Write-Host ""
    Write-Host "DESTRUCTIVE: this removes the volumes for project '$project'." -ForegroundColor Red
    Write-Host "The development database and all its users, tokens, channels and logs will be permanently deleted." -ForegroundColor Red
    Write-Host "Take a backup first with: pwsh ./scripts/backup-db.ps1" -ForegroundColor Yellow
    Write-Host ""
    $answer = Read-Host "Type the project name '$project' to confirm"
    if ($answer -ne $project) {
        Write-Host "Aborted; nothing was removed." -ForegroundColor Green
        return
    }
    $code = Invoke-Compose -ComposeArgs $composeArgs -Command @('--profile', 'app', 'down', '--volumes', '--remove-orphans')
} else {
    $code = Invoke-Compose -ComposeArgs $composeArgs -Command @('--profile', 'app', 'down', '--remove-orphans')
}

if ($code -ne 0) { throw "docker compose down failed with exit code $code" }

Write-Host ""
if ($DeleteData) {
    Write-Host "Stack stopped and volumes deleted." -ForegroundColor Yellow
} else {
    Write-Host "Stack stopped. Volumes kept - data is intact." -ForegroundColor Green
}
