<#
.SYNOPSIS
    Runs `nginx -t` against the real production nginx configuration.

.DESCRIPTION
    Validates deploy/nginx/nginx.conf and deploy/nginx/conf.d/*.conf verbatim.
    No directive is substituted, relaxed, or removed to make the check pass —
    the files that get validated are exactly the files that get deployed.

    The only fixture supplied is a throwaway self-signed certificate pair,
    mounted where the config expects certificates to be. Real certificates are
    gitignored and are not needed to check syntax.

    The container is disposable (`--rm`), has no network, mounts only this
    repository's nginx configuration read-only, and touches no volume. It
    cannot affect the running stacks.

.NOTES
    Requires the ability to pull the nginx image. On a machine with no route to
    a container registry this cannot run locally; the `deploy-config` job in
    .github/workflows/platform-ci.yml performs the same check in CI.

.EXAMPLE
    pwsh ./scripts/verify-nginx.ps1
#>
[CmdletBinding()]
param(
    [string] $NginxImage = 'nginx:1.27-alpine',
    [string] $RepoRoot,
    [string] $ConfigRoot,
    [string] $EvidencePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
. (Join-Path $PSScriptRoot '_nginx-evidence.ps1')

$root = Get-RepoRoot -Root $RepoRoot
$nginxDir = if ($ConfigRoot) { Resolve-NginxConfigRoot -ConfigRoot $ConfigRoot } else { Join-Path $root 'deploy/nginx' }
$evidence = if ($EvidencePath) { $EvidencePath } else { Join-Path $root '.platform-tmp/nginx-verified.stamp' }

# Fail closed: an unsuccessful re-verification must not leave an older result
# looking like evidence for this attempt.
if (Test-Path -LiteralPath $evidence) { Remove-Item -LiteralPath $evidence -Force }
$before = Get-NginxConfigFingerprint -ConfigRoot $nginxDir

Assert-DockerEngine

# Confirm the image is available before doing any setup work, so an
# unreachable registry produces a clear message rather than a confusing
# failure later.
$present = (& docker image inspect $NginxImage --format '{{.Id}}' 2>$null)
if ($LASTEXITCODE -ne 0) {
    Write-Host "Image $NginxImage not present locally; pulling..." -ForegroundColor Cyan
    & docker pull $NginxImage 2>&1 | Select-Object -Last 3
    if ($LASTEXITCODE -ne 0) {
        throw @"
Could not obtain $NginxImage, so nginx syntax was NOT verified.

This machine has no working route to a container registry. That is an
environment problem, not a configuration problem — do not interpret this
failure as the nginx config being valid or invalid.

The same check runs in CI (.github/workflows/platform-ci.yml, deploy-config
job) where registry access is available. Treat the nginx configuration as
UNVERIFIED until that job passes.
"@
    }
}

# Throwaway certificate material, outside the repository.
$certDir = Join-Path ([System.IO.Path]::GetTempPath()) "aigw-nginx-verify-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

try {
    Write-Host "Generating throwaway certificate for syntax check..." -ForegroundColor DarkGray
    # Generated inside the same container image, so no host openssl is needed
    # and Git Bash cannot mangle the -subj argument into a Windows path.
    & docker run --rm --network none -v "${certDir}:/certs" $NginxImage `
        sh -c "openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout /certs/privkey.pem -out /certs/fullchain.pem -subj '/CN=gateway.example.invalid' 2>/dev/null"
    if ($LASTEXITCODE -ne 0) { throw "Could not generate test certificate (exit $LASTEXITCODE)" }

    Write-Host "Running nginx -t against the real configuration..." -ForegroundColor Cyan
    $output = & docker run --rm --network none `
        -v "$(Join-Path $nginxDir 'nginx.conf'):/etc/nginx/nginx.conf:ro" `
        -v "$(Join-Path $nginxDir 'conf.d'):/etc/nginx/conf.d:ro" `
        -v "${certDir}:/etc/nginx/certs:ro" `
        $NginxImage nginx -t 2>&1
    $code = $LASTEXITCODE

    $output | ForEach-Object { Write-Host "  $_" }

    if ($code -ne 0) {
        throw "nginx -t FAILED (exit $code). Fix the configuration; do not weaken it to pass."
    }

    $after = Get-NginxConfigFingerprint -ConfigRoot $nginxDir
    if ($before.Fingerprint -ne $after.Fingerprint) {
        throw 'nginx configuration changed during verification; no evidence was written. Run verification again.'
    }
    Write-NginxVerificationEvidence -Evidence (New-NginxVerificationEvidence -Fingerprint $after -NginxImage $NginxImage) -EvidencePath $evidence

    Write-Host ""
    Write-Host "nginx configuration syntax OK." -ForegroundColor Green
    Write-Host "  validated: deploy/nginx/nginx.conf" -ForegroundColor DarkGray
    Write-Host "  validated: deploy/nginx/conf.d/*.conf" -ForegroundColor DarkGray
    Write-Host "  evidence: $evidence" -ForegroundColor DarkGray
    Write-Host "  note: syntax only. It does not prove TLS, DNS or upstream reachability." -ForegroundColor DarkGray
} finally {
    Remove-Item -LiteralPath $certDir -Recurse -Force -ErrorAction SilentlyContinue
}
