<#
.SYNOPSIS
    Builds the React frontend into web/dist.

.DESCRIPTION
    The Go binary embeds web/dist via //go:embed, so this must succeed before
    the backend can be built or run.

    Upstream ships an EMPTY VERSION file (it is populated by their release CI),
    so this script falls back to the pinned upstream tag rather than baking an
    empty version string into the UI.

.EXAMPLE
    pwsh ./scripts/build-web.ps1
#>
[CmdletBinding()]
param(
    [string] $Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$webDir = Join-Path $root 'web'

# Prefer an explicit -Version, then the VERSION file, then the pinned tag.
if (-not $Version) {
    $versionFile = Join-Path $root 'VERSION'
    if (Test-Path -LiteralPath $versionFile) {
        $raw = (Get-Content -LiteralPath $versionFile -Raw -ErrorAction SilentlyContinue)
        if ($raw) { $Version = $raw.Trim() }
    }
}
if (-not $Version) { $Version = 'v1.0.0-rc.22-platform' }

$bunExe = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunExe) {
    $candidate = Join-Path $env:USERPROFILE '.bun/bin/bun.exe'
    if (Test-Path -LiteralPath $candidate) {
        $env:PATH = "$(Split-Path $candidate);$env:PATH"
    } else {
        throw "bun is not installed. Install it with: irm bun.sh/install.ps1 | iex"
    }
}

Push-Location $webDir
try {
    if (-not (Test-Path -LiteralPath (Join-Path $webDir 'node_modules'))) {
        Write-Host "Installing frontend dependencies (frozen lockfile)..." -ForegroundColor Cyan
        & bun install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "bun install failed with exit code $LASTEXITCODE" }
    }

    Write-Host "Building frontend (version $Version)..." -ForegroundColor Cyan
    $env:DISABLE_ESLINT_PLUGIN = 'true'
    $env:VITE_REACT_APP_VERSION = $Version
    & bun run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$index = Join-Path $webDir 'dist/index.html'
if (-not (Test-Path -LiteralPath $index)) {
    throw "Build reported success but web/dist/index.html is missing."
}

$size = [math]::Round((Get-ChildItem (Join-Path $webDir 'dist') -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Write-Host "Frontend built: web/dist ($size MB)" -ForegroundColor Green
