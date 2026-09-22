<# Minimal release-gate regression harness; no Docker or external test framework required. #>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot '_nginx-evidence.ps1')

function Assert-That { param([bool] $Condition, [string] $Message) if (-not $Condition) { throw "ASSERTION FAILED: $Message" } }
function Run-Preflight {
    param([string] $Root, [string] $ConfigRoot, [string] $EvidencePath)
    $out = & pwsh -NoProfile -File (Join-Path $repo 'scripts/preflight-release.ps1') -Environment prod -RepoRoot $Root -ConfigRoot $ConfigRoot -EvidencePath $EvidencePath 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
}
function Write-TestEnv { param([string] $Path) @'
SOURCE_CODE_URL=https://source.invalid/project
PRICING_STATUS=approved
SESSION_SECRET=session-test-secret
CRYPTO_SECRET=crypto-test-secret
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_TRUSTED_URL=https://gateway.invalid
TRUSTED_PROXIES=127.0.0.1
PLATFORM_PUBLIC_DOMAIN=gateway.invalid
PLATFORM_TAG=test-immutable-tag
NGINX_IMAGE=nginx
NGINX_TAG=test
'@ | Set-Content -LiteralPath $Path -NoNewline }

$root = Join-Path ([IO.Path]::GetTempPath()) ('aigw-nginx-evidence-test-' + [guid]::NewGuid().ToString('N'))
try {
    $config = Join-Path $root 'deploy/nginx'; $confD = Join-Path $config 'conf.d'
    New-Item -ItemType Directory -Force -Path $confD | Out-Null
    @'
events {}
http { include /etc/nginx/conf.d/*.conf; }
'@ | Set-Content -LiteralPath (Join-Path $config 'nginx.conf') -NoNewline
    'server { listen 80; }' | Set-Content -LiteralPath (Join-Path $confD 'gateway.conf') -NoNewline
    Write-TestEnv -Path (Join-Path $root 'deploy/.env.prod')
    $evidence = Join-Path $root '.platform-tmp/nginx-verified.stamp'

    $result = Run-Preflight $root $config $evidence
    Assert-That ($result.Code -ne 0 -and $result.Output -match 'evidence missing') 'missing evidence must fail'

    $fingerprint = Get-NginxConfigFingerprint -ConfigRoot $config
    Write-NginxVerificationEvidence -Evidence (New-NginxVerificationEvidence -Fingerprint $fingerprint -NginxImage 'nginx:test') -EvidencePath $evidence
    $result = Run-Preflight $root $config $evidence
    Assert-That ($result.Code -eq 0 -and $result.Output -match 'NGINX') 'matching evidence must pass'

    Write-NginxVerificationEvidence -Evidence (New-NginxVerificationEvidence -Fingerprint $fingerprint -NginxImage 'nginx:other') -EvidencePath $evidence
    $result = Run-Preflight $root $config $evidence
    Assert-That ($result.Code -ne 0 -and $result.Output -match 'image does not match') 'wrong verification image must fail'
    Write-NginxVerificationEvidence -Evidence (New-NginxVerificationEvidence -Fingerprint $fingerprint -NginxImage 'nginx:test') -EvidencePath $evidence

    Add-Content -LiteralPath (Join-Path $config 'nginx.conf') -Value "`n# changed"
    $result = Run-Preflight $root $config $evidence
    Assert-That ($result.Code -ne 0 -and $result.Output -match 'changed since verification') 'nginx.conf change must fail'

    $fingerprint = Get-NginxConfigFingerprint -ConfigRoot $config
    Write-NginxVerificationEvidence -Evidence (New-NginxVerificationEvidence -Fingerprint $fingerprint -NginxImage 'nginx:test') -EvidencePath $evidence
    Add-Content -LiteralPath (Join-Path $confD 'gateway.conf') -Value "`n# changed"
    $result = Run-Preflight $root $config $evidence
    Assert-That ($result.Code -ne 0 -and $result.Output -match 'changed since verification') 'conf.d change must fail'

    '{broken' | Set-Content -LiteralPath $evidence -NoNewline
    $result = Run-Preflight $root $config $evidence
    Assert-That ($result.Code -ne 0 -and $result.Output -match 'evidence invalid') 'corrupt evidence must fail'

    '' | Set-Content -LiteralPath $evidence -NoNewline
    $result = Run-Preflight $root $config $evidence
    Assert-That ($result.Code -ne 0 -and $result.Output -match 'evidence invalid') 'empty evidence must fail'

    $fingerprint = Get-NginxConfigFingerprint -ConfigRoot $config
    Write-NginxVerificationEvidence -Evidence (New-NginxVerificationEvidence -Fingerprint $fingerprint -NginxImage 'nginx:test') -EvidencePath $evidence
    Remove-Item -LiteralPath (Join-Path $confD 'gateway.conf') -Force
    & pwsh -NoProfile -File (Join-Path $repo 'scripts/verify-nginx.ps1') -RepoRoot $root -ConfigRoot $config -EvidencePath $evidence 2>$null
    Assert-That ($LASTEXITCODE -ne 0 -and -not (Test-Path -LiteralPath $evidence)) 'failed verification must remove prior evidence'
    Write-Host 'nginx release evidence tests passed.' -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
