<#
.SYNOPSIS
Safely removes only Playwright-created login Session rows from development.

.DESCRIPTION
Dry-run is the default. Exact-SID cleanup is used by the E2E fixture after it
calls the product logout endpoint. Run-scoped or stale cleanup is available for
an interrupted local/CI run. Every delete is guarded by the HYC-E2E/ User-Agent
marker recorded on the Session row. Production is always refused.
#>
[CmdletBinding()]
param(
    [ValidateSet('dev', 'prod')]
    [string] $Environment = 'dev',
    [string] $SessionId,
    [string] $RunId,
    [ValidateRange(1, 10080)]
    [int] $StaleMinutes = 60,
    [switch] $Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Environment -ne 'dev') {
    throw 'E2E Session cleanup is development-only and refuses production.'
}
if ($SessionId -and $SessionId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    throw 'SessionId must be a UUID.'
}
if ($RunId -and $RunId -notmatch '^[A-Za-z0-9_-]{1,80}$') {
    throw 'RunId may contain only letters, digits, underscore, and hyphen.'
}

. (Join-Path $PSScriptRoot '_common.ps1')
$envPath = Get-EnvFilePath -Environment dev
$projectName = Get-ProjectName -EnvFilePath $envPath
if ($projectName -ne 'ai-gateway-dev') {
    throw "Refusing unexpected Compose project '$projectName'."
}

$container = 'ai-gateway-dev-postgres-1'
$mode = if ($Execute) { 'DELETE' } else { 'DRY RUN' }
Write-Host "${mode}: matching only user_sessions.user_agent LIKE 'HYC-E2E/%'" -ForegroundColor Cyan

$query = if ($SessionId) {
    if ($Execute) {
        "delete from user_sessions where sid = '$SessionId' and user_agent like 'HYC-E2E/%' returning sid, user_id, status;"
    } else {
        "select sid, user_id, status, created_at from user_sessions where sid = '$SessionId' and user_agent like 'HYC-E2E/%';"
    }
} else {
    $runClause = if ($RunId) { "and user_agent like 'HYC-E2E/$RunId/%'" } else { '' }
    $safeClause = "and (status <> 'active' or revoked_at > 0 or expires_at <= extract(epoch from now()) or last_active_at < extract(epoch from now()) - ($StaleMinutes * 60))"
    if ($Execute) {
        "delete from user_sessions where user_agent like 'HYC-E2E/%' $runClause $safeClause returning sid, user_id, status;"
    } else {
        "select sid, user_id, status, created_at from user_sessions where user_agent like 'HYC-E2E/%' $runClause $safeClause order by created_at;"
    }
}

$args = @(
    'exec',
    '--env', "E2E_QUERY=$query",
    $container,
    'sh', '-c',
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "$E2E_QUERY"'
)
& docker @args
if ($LASTEXITCODE -ne 0) {
    throw "E2E Session cleanup failed with exit code $LASTEXITCODE."
}
