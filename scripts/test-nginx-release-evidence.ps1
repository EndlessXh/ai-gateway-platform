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
function Write-MockDocker {
    param([string] $Directory)
@'
@echo off
if /I "%~1"=="info" (
  echo 27.0.0
  exit /b 0
)
exit /b 0
'@ | Set-Content -LiteralPath (Join-Path $Directory 'docker.cmd') -NoNewline
}
function Write-MockOpenSsl {
    param([string] $Directory, [int] $ExitCode = 0)
    @"
@echo off
setlocal EnableDelayedExpansion
if not "%AIGW_OPENSSL_LOG%"=="" > "%AIGW_OPENSSL_LOG%" echo %~f0
set "key=" & set "cert="
:next
if "%~1"=="" goto done
if /I "%~1"=="-keyout" (set "key=%~2" & shift & shift & goto next)
if /I "%~1"=="-out" (set "cert=%~2" & shift & shift & goto next)
shift
goto next
:done
if "%key%"=="" exit /b 2
if "%cert%"=="" exit /b 2
> "%key%" echo disposable key
> "%cert%" echo disposable certificate
exit /b $ExitCode
"@ | Set-Content -LiteralPath (Join-Path $Directory 'openssl.cmd') -NoNewline
}
function Run-Verify {
    param([string] $Root, [string] $ConfigRoot, [string] $EvidencePath, [string] $ToolPath, [string] $CertTemp)
    $oldPath = $env:PATH; $oldTemp = $env:TEMP; $oldTmp = $env:TMP
    try {
        $env:PATH = $ToolPath
        $env:TEMP = $CertTemp; $env:TMP = $CertTemp
        $out = & (Get-Process -Id $PID).Path -NoProfile -File (Join-Path $repo 'scripts/verify-nginx.ps1') -RepoRoot $Root -ConfigRoot $ConfigRoot -EvidencePath $EvidencePath 2>&1 | Out-String
        return [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
    } finally {
        $env:PATH = $oldPath; $env:TEMP = $oldTemp; $env:TMP = $oldTmp
    }
}
function Run-VerifyWithOpenSslMatches {
    param(
        [string] $Root,
        [string] $ConfigRoot,
        [string] $EvidencePath,
        [string] $ToolPath,
        [string] $CertTemp,
        [string] $FirstOpenSsl,
        [string] $SecondOpenSsl,
        [string] $InvocationLog
    )
    $wrapper = Join-Path $Root 'run-verify-with-multiple-openssl.ps1'
    $quote = { param([string] $Value) "'" + $Value.Replace("'", "''") + "'" }
    @"
function Get-Command {
    [CmdletBinding()]
    param([Parameter(Position = 0)][string] `$Name, [System.Management.Automation.CommandTypes] `$CommandType)
    if (`$Name -eq 'openssl' -and `$CommandType -eq [System.Management.Automation.CommandTypes]::Application) {
        return @(
            [pscustomobject]@{ CommandType = 'Application'; Source = $(& $quote $FirstOpenSsl) },
            [pscustomobject]@{ CommandType = 'Application'; Source = $(& $quote $SecondOpenSsl) }
        )
    }
    return Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
`$env:AIGW_OPENSSL_LOG = $(& $quote $InvocationLog)
& $(& $quote (Join-Path $repo 'scripts/verify-nginx.ps1')) -RepoRoot $(& $quote $Root) -ConfigRoot $(& $quote $ConfigRoot) -EvidencePath $(& $quote $EvidencePath)
exit `$LASTEXITCODE
"@ | Set-Content -LiteralPath $wrapper -NoNewline
    $oldPath = $env:PATH; $oldTemp = $env:TEMP; $oldTmp = $env:TMP
    try {
        $env:PATH = $ToolPath
        $env:TEMP = $CertTemp; $env:TMP = $CertTemp
        $out = & (Get-Process -Id $PID).Path -NoProfile -File $wrapper 2>&1 | Out-String
        return [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
    } finally {
        $env:PATH = $oldPath; $env:TEMP = $oldTemp; $env:TMP = $oldTmp
    }
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

    $tools = Join-Path $root 'mock-tools'; $certTemp = Join-Path $root 'cert-temp'
    New-Item -ItemType Directory -Force -Path $tools, $certTemp | Out-Null
    Write-MockDocker -Directory $tools
    Write-MockOpenSsl -Directory $tools
    $result = Run-Verify $root $config $evidence $tools $certTemp
    Assert-That ($result.Code -eq 0 -and (Test-Path -LiteralPath $evidence)) 'disposable certificate generation and verification must succeed'
    Assert-That (-not (Get-ChildItem -LiteralPath $certTemp -Filter 'aigw-nginx-verify-*' -ErrorAction SilentlyContinue)) 'disposable certificate directory must be cleaned'

    Remove-Item -LiteralPath $evidence -Force
    $secondTools = Join-Path $root 'second-mock-tools'
    New-Item -ItemType Directory -Force -Path $secondTools | Out-Null
    Write-MockOpenSsl -Directory $secondTools
    $invocationLog = Join-Path $root 'openssl-invocation.log'
    $result = Run-VerifyWithOpenSslMatches $root $config $evidence $tools $certTemp (Join-Path $tools 'openssl.cmd') (Join-Path $secondTools 'openssl.cmd') $invocationLog
    Assert-That ($result.Code -eq 0 -and (Test-Path -LiteralPath $evidence)) 'multiple openssl application matches must still verify successfully'
    Assert-That ((Get-Content -LiteralPath $invocationLog -Raw).Trim() -eq (Resolve-Path -LiteralPath (Join-Path $tools 'openssl.cmd')).Path) 'multiple openssl matches must invoke only the first executable path'
    Assert-That (-not (Get-ChildItem -LiteralPath $certTemp -Filter 'aigw-nginx-verify-*' -ErrorAction SilentlyContinue)) 'multiple-match disposable certificate directory must be cleaned'

    Remove-Item -LiteralPath $evidence -Force
    Write-MockOpenSsl -Directory $tools -ExitCode 7
    $result = Run-Verify $root $config $evidence $tools $certTemp
    Assert-That ($result.Code -ne 0 -and $result.Output -match 'Could not generate test certificate \(exit 7\)') 'non-zero openssl must fail verification clearly'
    Assert-That (-not (Test-Path -LiteralPath $evidence)) 'non-zero openssl must not write evidence'
    Assert-That (-not (Get-ChildItem -LiteralPath $certTemp -Filter 'aigw-nginx-verify-*' -ErrorAction SilentlyContinue)) 'non-zero openssl disposable certificate directory must be cleaned'
    Write-MockOpenSsl -Directory $tools

    if (Test-Path -LiteralPath $evidence) { Remove-Item -LiteralPath $evidence -Force }
    Remove-Item -LiteralPath (Join-Path $tools 'openssl.cmd') -Force
    $result = Run-Verify $root $config $evidence $tools $certTemp
    Assert-That ($result.Code -ne 0 -and $result.Output -match "Required executable 'openssl' was not found") 'missing openssl must fail clearly without evidence'
    Assert-That (-not (Test-Path -LiteralPath $evidence)) 'missing openssl must not write evidence'

    $fingerprint = Get-NginxConfigFingerprint -ConfigRoot $config
    Write-NginxVerificationEvidence -Evidence (New-NginxVerificationEvidence -Fingerprint $fingerprint -NginxImage 'nginx:test') -EvidencePath $evidence
    Remove-Item -LiteralPath (Join-Path $confD 'gateway.conf') -Force
    & pwsh -NoProfile -File (Join-Path $repo 'scripts/verify-nginx.ps1') -RepoRoot $root -ConfigRoot $config -EvidencePath $evidence 2>$null
    Assert-That ($LASTEXITCODE -ne 0 -and -not (Test-Path -LiteralPath $evidence)) 'failed verification must remove prior evidence'
    Write-Host 'nginx release evidence tests passed.' -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
