<#
.SYNOPSIS
    Production readiness gate. Fails while any launch blocker remains.

.DESCRIPTION
    Single place that answers "is this allowed to serve real customers yet".
    Run it before any production deploy, and in CI.

    Checks:
      1. AGPLv3 section 13 — a real source-code offer is configured
      2. Pricing has been approved (not the development placeholders)
      3. No placeholder secrets remain
      4. Production security posture (secure cookies, trusted origins, proxies)
      5. Image tag is pinned, not floating
      6. nginx configuration has been syntax-checked

    Development is expected to fail this. That is the point: the blockers are
    visible from day one instead of being discovered on deploy day.

.PARAMETER Environment
    dev (default) reports blockers but exits 0 unless -Strict.
    prod exits non-zero on any blocker.

.PARAMETER Strict
    Treat blockers as fatal even for dev. Used by CI to prove the gate fires.

.EXAMPLE
    pwsh ./scripts/preflight-release.ps1
    pwsh ./scripts/preflight-release.ps1 -Environment prod
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [ValidateSet('dev', 'prod')]
    [string] $Environment = 'dev',
    [switch] $Strict
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment $Environment
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Env file not found: $envPath`nRun: pwsh ./scripts/new-secrets.ps1 -Environment $Environment"
}
$map = Read-EnvFile -Path $envPath

$blockers = @()
$passes = @()

function Add-Blocker { param([string] $Id, [string] $Message) $script:blockers += [pscustomobject]@{ Id = $Id; Message = $Message } }
function Add-Pass { param([string] $Id, [string] $Message) $script:passes += [pscustomobject]@{ Id = $Id; Message = $Message } }

function Get-Val { param([string] $Key) if ($map.Contains($Key)) { return "$($map[$Key])".Trim() } return '' }

Write-Host "Release preflight - environment: $Environment" -ForegroundColor Cyan
Write-Host "Env file: $envPath" -ForegroundColor DarkGray
Write-Host ("=" * 78)

# ── 1. AGPLv3 section 13 source offer ────────────────────────────────────────
$sourceUrl = Get-Val 'SOURCE_CODE_URL'
$placeholderMarkers = @('example.com', 'example.invalid', 'replace_me', 'changeme', 'todo', 'localhost', '127.0.0.1')
$parsedSourceUrl = $null
$sourceUrlIsValid = [Uri]::TryCreate($sourceUrl, [UriKind]::Absolute, [ref] $parsedSourceUrl) -and
    $parsedSourceUrl.Scheme -eq 'https' -and
    -not [string]::IsNullOrWhiteSpace($parsedSourceUrl.DnsSafeHost) -and
    [string]::IsNullOrEmpty($parsedSourceUrl.UserInfo)

if (-not $sourceUrl) {
    Add-Blocker 'AGPL-13' 'SOURCE_CODE_URL is empty. AGPLv3 section 13 requires offering the Corresponding Source to users of a network service. Publish this modified source somewhere publicly reachable and set the URL.'
} elseif (@($placeholderMarkers | Where-Object { $sourceUrl.ToLower().Contains($_) }).Count -gt 0) {
    Add-Blocker 'AGPL-13' "SOURCE_CODE_URL looks like a placeholder ('$sourceUrl'). It must be a real, publicly reachable location."
} elseif (-not $sourceUrlIsValid) {
    Add-Blocker 'AGPL-13' "SOURCE_CODE_URL must be a valid absolute https URL without embedded credentials (got '$sourceUrl')."
} else {
    Add-Pass 'AGPL-13' "source offer configured: $sourceUrl"
}

# Attribution must not be overridable. If someone adds an env var to blank it,
# fail loudly rather than shipping a licence violation.
foreach ($forbidden in @('UPSTREAM_PROJECT_NAME', 'UPSTREAM_PROJECT_URL', 'ATTRIBUTION_NOTICE')) {
    if ($map.Contains($forbidden)) {
        Add-Blocker 'AGPL-7B' "$forbidden is set in the env file. Upstream attribution is a licence obligation and must stay as constants in setting/platform/compliance.go, not configuration."
    }
}
if (@($blockers | Where-Object { $_.Id -eq 'AGPL-7B' }).Count -eq 0) {
    Add-Pass 'AGPL-7B' 'attribution is not environment-overridable'
}

# ── 2. Pricing approval ──────────────────────────────────────────────────────
$pricingStatus = Get-Val 'PRICING_STATUS'
if ($pricingStatus -ne 'approved') {
    Add-Blocker 'PRICING' "PRICING_STATUS is '$(if ($pricingStatus) { $pricingStatus } else { '<unset>' })', not 'approved'. The configured model prices are development placeholders (see docs/adr/0005-provisional-model-pricing.md) and must not charge real customers."
} else {
    Add-Pass 'PRICING' 'pricing marked approved'
}

# ── 3. No placeholder secrets ────────────────────────────────────────────────
$placeholders = @($map.Keys | Where-Object { "$($map[$_])" -match 'REPLACE_ME' })
if ($placeholders.Count -gt 0) {
    Add-Blocker 'SECRETS' "Placeholder values remain for: $($placeholders -join ', '). Run scripts/new-secrets.ps1."
} else {
    Add-Pass 'SECRETS' 'no placeholder secrets'
}

# SESSION_SECRET and CRYPTO_SECRET serve different purposes; reusing one value
# means compromising a session token also compromises stored-secret integrity.
$sessionSecret = Get-Val 'SESSION_SECRET'
$cryptoSecret = Get-Val 'CRYPTO_SECRET'
if ($sessionSecret -and $cryptoSecret -and $sessionSecret -eq $cryptoSecret) {
    Add-Blocker 'SECRETS' 'SESSION_SECRET and CRYPTO_SECRET are identical. They must be independent values.'
} elseif ($sessionSecret -and $cryptoSecret) {
    Add-Pass 'SECRETS' 'session and crypto secrets are distinct'
}

# ── 4. Production security posture ───────────────────────────────────────────
if ($Environment -eq 'prod') {
    if ((Get-Val 'SESSION_COOKIE_SECURE') -ne 'true') {
        Add-Blocker 'SECURITY' 'SESSION_COOKIE_SECURE must be true in production.'
    } else {
        Add-Pass 'SECURITY' 'secure cookies enabled'
    }

    $trustedUrl = Get-Val 'SESSION_COOKIE_TRUSTED_URL'
    if (-not $trustedUrl) {
        Add-Blocker 'SECURITY' 'SESSION_COOKIE_TRUSTED_URL is empty. Production requires an explicit list of trusted HTTPS origins.'
    } elseif ($trustedUrl -notlike 'https://*') {
        Add-Blocker 'SECURITY' "SESSION_COOKIE_TRUSTED_URL must list https origins (got '$trustedUrl')."
    } else {
        Add-Pass 'SECURITY' 'trusted origins configured'
    }

    $trustedProxies = Get-Val 'TRUSTED_PROXIES'
    if ($trustedProxies -eq 'none' -or -not $trustedProxies) {
        Add-Blocker 'SECURITY' "TRUSTED_PROXIES is '$trustedProxies'. Behind nginx this must list the proxy address, or client IPs in logs and rate limits will be wrong."
    } else {
        Add-Pass 'SECURITY' "trusted proxies set: $trustedProxies"
    }

    $domain = Get-Val 'PLATFORM_PUBLIC_DOMAIN'
    if (-not $domain -or $domain -like '*example.invalid*' -or $domain -like '*example.com*') {
        Add-Blocker 'SECURITY' "PLATFORM_PUBLIC_DOMAIN is unset or a placeholder ('$domain')."
    } else {
        Add-Pass 'SECURITY' "public domain: $domain"
    }

    $tag = Get-Val 'PLATFORM_TAG'
    if (-not $tag -or $tag -eq 'latest' -or $tag -eq 'dev') {
        Add-Blocker 'RELEASE' "PLATFORM_TAG is '$tag'. Production must run an immutable, pinned tag - never 'latest' or 'dev'."
    } else {
        Add-Pass 'RELEASE' "image tag pinned: $tag"
    }
}

# ── 5. nginx configuration verified ──────────────────────────────────────────
# Tracked as an explicit blocker because it could not be checked on the
# authoring machine (no container registry route). CI runs it.
$nginxStamp = Join-Path $root '.platform-tmp/nginx-verified.stamp'
if (Test-Path -LiteralPath $nginxStamp) {
    Add-Pass 'NGINX' "nginx -t previously passed ($(Get-Content -LiteralPath $nginxStamp -Raw))".Trim()
} else {
    Add-Blocker 'NGINX' 'nginx configuration has not been syntax-checked on this machine. Run scripts/verify-nginx.ps1 (needs container registry access), or confirm the CI deploy-config job passed.'
}

# ── Report ───────────────────────────────────────────────────────────────────
foreach ($p in $passes) {
    Write-Host ("[ OK ]      {0,-10} {1}" -f $p.Id, $p.Message) -ForegroundColor Green
}
foreach ($b in $blockers) {
    Write-Host ("[BLOCKER]   {0,-10} {1}" -f $b.Id, $b.Message) -ForegroundColor Red
}

Write-Host ("=" * 78)

if ($blockers.Count -eq 0) {
    Write-Host "No launch blockers. Cleared for production." -ForegroundColor Green
    exit 0
}

Write-Host "$($blockers.Count) launch blocker(s)." -ForegroundColor Red

if ($Environment -eq 'prod' -or $Strict) {
    Write-Host "Refusing to proceed." -ForegroundColor Red
    exit 1
}

Write-Host "Development environment: not fatal, but these MUST be resolved before production." -ForegroundColor Yellow
exit 0
