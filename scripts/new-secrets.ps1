<#
.SYNOPSIS
    Creates an environment file with freshly generated, cryptographically
    secure secrets.

.DESCRIPTION
    Copies deploy/.env.example to the target env file (if it does not exist)
    and replaces every REPLACE_ME_* placeholder with a random value.

    Secrets are generated with System.Security.Cryptography.RandomNumberGenerator.
    Get-Random is deliberately NOT used: it is a deterministic PRNG and is not
    suitable for credentials.

    CRYPTO_SECRET encrypts stored upstream channel keys. Rotating it after
    channels exist makes every stored key undecryptable, so this script
    refuses to overwrite an existing file unless -Force is given.

.EXAMPLE
    pwsh ./scripts/new-secrets.ps1
    pwsh ./scripts/new-secrets.ps1 -EnvFile deploy/.env.prod
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [ValidateSet('dev', 'prod')]
    [string] $Environment = 'dev',
    [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$target = Get-EnvFilePath -EnvFile $EnvFile -Environment $Environment
$template = Join-Path $root 'deploy/.env.example'

if (-not (Test-Path -LiteralPath $template)) {
    throw "Template not found: $template"
}

if ((Test-Path -LiteralPath $target) -and -not $Force) {
    $existing = Read-EnvFile -Path $target
    $placeholders = @($existing.Keys | Where-Object { $existing[$_] -match 'REPLACE_ME' })

    if ($placeholders.Count -eq 0) {
        Write-Host "Env file already fully populated: $target" -ForegroundColor Yellow
        Write-Host "Nothing to do. Use -Force to regenerate ALL secrets." -ForegroundColor Yellow
        Write-Host "WARNING: regenerating CRYPTO_SECRET makes existing stored channel keys undecryptable." -ForegroundColor Red
        return
    }

    # Fill in only the still-placeholder keys, preserving everything else.
    Write-Host "Filling $($placeholders.Count) placeholder(s) in existing file: $target" -ForegroundColor Cyan
    $lines = [System.IO.File]::ReadAllLines($target)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*.*REPLACE_ME') {
            $key = $Matches[1]
            $lines[$i] = "$key=$(New-RandomSecret -Bytes 48)"
            Write-Host "  generated $key" -ForegroundColor DarkGray
        }
    }
    [System.IO.File]::WriteAllLines($target, $lines, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Updated: $target" -ForegroundColor Green
    return
}

$targetDir = Split-Path -Parent $target
if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

$lines = [System.IO.File]::ReadAllLines($template)
$generated = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*.*REPLACE_ME') {
        $key = $Matches[1]
        $lines[$i] = "$key=$(New-RandomSecret -Bytes 48)"
        $generated += $key
    }
}

[System.IO.File]::WriteAllLines($target, $lines, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Created $target" -ForegroundColor Green
foreach ($g in $generated) { Write-Host "  generated $g" -ForegroundColor DarkGray }
Write-Host ""
Write-Host "This file contains live credentials and is gitignored. Never commit it." -ForegroundColor Yellow
if ($Environment -eq 'prod') {
    Write-Host "Production still requires manual review: PLATFORM_PUBLIC_DOMAIN, SESSION_COOKIE_TRUSTED_URL, TRUSTED_PROXIES, PLATFORM_TAG." -ForegroundColor Yellow
}
