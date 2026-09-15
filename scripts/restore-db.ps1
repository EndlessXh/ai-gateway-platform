<#
.SYNOPSIS
    Restores a PostgreSQL backup into the platform database.

.DESCRIPTION
    Restores a pg_dump custom-format archive produced by backup-db.ps1.

    This OVERWRITES the target database. It always takes a pre-restore safety
    backup first, so a mistaken restore is itself recoverable.

    Refuses to target production unless -Confirm is passed with the exact
    database name, to make an accidental prod restore impossible to do by
    reflex.

.PARAMETER Verify
    Restore into a scratch database instead of the live one and report the
    resulting table count. This is the safe way to prove a backup is
    restorable without touching real data.

.EXAMPLE
    pwsh ./scripts/restore-db.ps1 -Path deploy/backups/dev-aigw-20260728-120000.dump -Verify
    pwsh ./scripts/restore-db.ps1 -Path deploy/backups/dev-aigw-20260728-120000.dump
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Path,
    [string] $EnvFile,
    [ValidateSet('dev', 'prod')]
    [string] $Environment = 'dev',
    [switch] $Verify,
    [string] $ConfirmDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

Assert-DockerEngine

$root = Get-RepoRoot
$dumpPath = if ([System.IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $root $Path }
if (-not (Test-Path -LiteralPath $dumpPath)) { throw "Backup not found: $dumpPath" }

$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment $Environment
if (-not (Test-Path -LiteralPath $envPath)) { throw "Env file not found: $envPath" }

$map = Read-EnvFile -Path $envPath
$composeArgs = Get-ComposeArgs -EnvFilePath $envPath -Environment $Environment
$dbName = $map['POSTGRES_DB']

$pgId = (& docker @($composeArgs + @('ps', '-q', 'postgres')) 2>$null | Select-Object -First 1)
if (-not $pgId) { throw "postgres container is not running for environment '$Environment'." }

$fileName = Split-Path $dumpPath -Leaf
& docker cp $dumpPath "${pgId}:/tmp/$fileName"
if ($LASTEXITCODE -ne 0) { throw "docker cp into container failed" }

# Validate the archive before it is allowed anywhere near a database.
$null = & docker exec $pgId pg_restore -l "/tmp/$fileName" 2>&1
if ($LASTEXITCODE -ne 0) {
    & docker exec $pgId rm -f "/tmp/$fileName" | Out-Null
    throw "Archive is not a valid pg_dump custom-format file: $fileName"
}

if ($Verify) {
    # --- Non-destructive restore drill into a scratch database ---------------
    $scratch = "restore_verify_$(Get-Date -Format 'yyyyMMddHHmmss')"
    Write-Host "Verify mode: restoring into scratch database '$scratch' (live data untouched)." -ForegroundColor Cyan

    & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d postgres -c 'CREATE DATABASE $scratch;'" | Out-Null
    if ($LASTEXITCODE -ne 0) { & docker exec $pgId rm -f "/tmp/$fileName" | Out-Null; throw "Could not create scratch database" }

    # --no-owner/--no-acl: the scratch DB has no matching roles.
    & docker exec $pgId sh -c "pg_restore -U `"`$POSTGRES_USER`" -d $scratch --no-owner --no-acl '/tmp/$fileName'" 2>&1 | Out-Null
    $restoreCode = $LASTEXITCODE

    $tables = & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc `"select count(*) from pg_tables where schemaname='public';`"" 2>$null
    $rows = & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc `"select count(*) from users;`"" 2>$null

    & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d postgres -c 'DROP DATABASE $scratch;'" | Out-Null
    & docker exec $pgId rm -f "/tmp/$fileName" | Out-Null

    Write-Host ""
    Write-Host "Restore drill result" -ForegroundColor Cyan
    Write-Host "  archive     : $fileName"
    Write-Host "  pg_restore  : exit $restoreCode"
    Write-Host "  tables      : $("$tables".Trim())"
    Write-Host "  users rows  : $("$rows".Trim())"
    if ("$tables".Trim() -match '^\d+$' -and [int]"$tables".Trim() -gt 0) {
        Write-Host "Backup is restorable." -ForegroundColor Green
        return
    }
    throw "Restore drill produced no tables; treat this backup as unusable."
}

# --- Destructive restore ------------------------------------------------------
if ($Environment -eq 'prod' -and $ConfirmDatabase -ne $dbName) {
    & docker exec $pgId rm -f "/tmp/$fileName" | Out-Null
    throw "Refusing to restore into production. Re-run with -ConfirmDatabase $dbName"
}

Write-Host ""
Write-Host "About to OVERWRITE database '$dbName' ($Environment) with $fileName." -ForegroundColor Red
if (-not $ConfirmDatabase) {
    $answer = Read-Host "Type the database name '$dbName' to confirm"
    if ($answer -ne $dbName) {
        & docker exec $pgId rm -f "/tmp/$fileName" | Out-Null
        Write-Host "Aborted; nothing was changed." -ForegroundColor Green
        return
    }
}

Write-Host "Taking a pre-restore safety backup..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'backup-db.ps1') -EnvFile $envPath -Environment $Environment -Label 'pre-restore'

Write-Host "Restoring..." -ForegroundColor Cyan
& docker exec $pgId sh -c "pg_restore -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" --clean --if-exists --no-owner --no-acl '/tmp/$fileName'" 2>&1 | Out-Null
$code = $LASTEXITCODE
& docker exec $pgId rm -f "/tmp/$fileName" | Out-Null

# pg_restore exits 1 on non-fatal warnings (e.g. DROP of a missing object with
# --clean). Report the real state rather than trusting the exit code alone.
$tables = & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -tAc `"select count(*) from pg_tables where schemaname='public';`"" 2>$null

Write-Host ""
Write-Host "pg_restore exit: $code" -ForegroundColor $(if ($code -eq 0) { 'Green' } else { 'Yellow' })
Write-Host "tables now in '$dbName': $("$tables".Trim())"
if ("$tables".Trim() -match '^\d+$' -and [int]"$tables".Trim() -gt 0) {
    Write-Host "Restore completed." -ForegroundColor Green
} else {
    throw "Restore left the database with no tables; investigate before using this environment."
}
