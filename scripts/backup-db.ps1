<#
.SYNOPSIS
    Creates a verified PostgreSQL backup of the platform database.

.DESCRIPTION
    Uses pg_dump custom format (-Fc), which is compressed and restorable
    selectively with pg_restore.

    The dump is written INSIDE the container and then copied out with
    `docker cp`. It is deliberately NOT piped through the PowerShell pipeline:
    `docker exec ... > file` passes binary through PowerShell's text/encoding
    layer and can silently corrupt the archive.

    Every backup is verified with `pg_restore -l` before being accepted. A
    backup that cannot be listed is deleted rather than left as a false
    sense of safety.

.PARAMETER Environment
    dev (default) or prod.

.PARAMETER RetentionDays
    Delete local backups older than this. Defaults to BACKUP_RETENTION_DAYS
    from the env file, or 14.

.EXAMPLE
    pwsh ./scripts/backup-db.ps1
    pwsh ./scripts/backup-db.ps1 -Environment prod -Label pre-upgrade
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [ValidateSet('dev', 'prod')]
    [string] $Environment = 'dev',
    [string] $Label,
    [int] $RetentionDays,
    [string] $OutDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

Assert-DockerEngine

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment $Environment
if (-not (Test-Path -LiteralPath $envPath)) { throw "Env file not found: $envPath" }

$map = Read-EnvFile -Path $envPath
$composeArgs = Get-ComposeArgs -EnvFilePath $envPath -Environment $Environment

if (-not $OutDir) { $OutDir = Join-Path $root 'deploy/backups' }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

if (-not $RetentionDays) {
    $RetentionDays = if ($map.Contains('BACKUP_RETENTION_DAYS') -and $map['BACKUP_RETENTION_DAYS']) { [int]$map['BACKUP_RETENTION_DAYS'] } else { 14 }
}

$pgId = (& docker @($composeArgs + @('ps', '-q', 'postgres')) 2>$null | Select-Object -First 1)
if (-not $pgId) { throw "postgres container is not running for environment '$Environment'. Start it first." }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$suffix = if ($Label) { "-$($Label -replace '[^A-Za-z0-9_.-]', '_')" } else { '' }
$name = "$Environment-$($map['POSTGRES_DB'])-$stamp$suffix.dump"
$inContainer = "/tmp/$name"
$outPath = Join-Path $OutDir $name

Write-Host "Dumping database '$($map['POSTGRES_DB'])' from container $($pgId.Substring(0,12))..." -ForegroundColor Cyan

# --clean/--if-exists make the archive safely re-appliable onto an existing DB.
& docker exec $pgId sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -Fc --clean --if-exists -f '$inContainer'"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

& docker cp "${pgId}:$inContainer" $outPath
if ($LASTEXITCODE -ne 0) { throw "docker cp failed with exit code $LASTEXITCODE" }

& docker exec $pgId rm -f $inContainer | Out-Null

if (-not (Test-Path -LiteralPath $outPath)) { throw "Backup file was not produced: $outPath" }

# --- Verify -------------------------------------------------------------------
# A backup is only real if it can be read back. Verify the archive TOC inside
# the container using the same pg_restore version that wrote it.
& docker cp $outPath "${pgId}:/tmp/verify-$name" | Out-Null
$toc = & docker exec $pgId pg_restore -l "/tmp/verify-$name" 2>&1
$verifyCode = $LASTEXITCODE
& docker exec $pgId rm -f "/tmp/verify-$name" | Out-Null

if ($verifyCode -ne 0) {
    Remove-Item -LiteralPath $outPath -Force
    throw "Backup verification FAILED (pg_restore -l exit $verifyCode); corrupt archive deleted.`n$toc"
}

$entries = @($toc | Where-Object { $_ -notmatch '^;' -and "$_".Trim() -ne '' }).Count
$sizeKb = [math]::Round((Get-Item $outPath).Length / 1KB, 1)

Write-Host "Backup OK: $name" -ForegroundColor Green
Write-Host "  path    : $outPath"
Write-Host "  size    : $sizeKb KB"
Write-Host "  verified: pg_restore -l listed $entries entries"

# --- Retention ----------------------------------------------------------------
$cutoff = (Get-Date).AddDays(-$RetentionDays)
$old = @(Get-ChildItem -LiteralPath $OutDir -Filter "$Environment-*.dump" -File | Where-Object { $_.LastWriteTime -lt $cutoff })
foreach ($f in $old) {
    Remove-Item -LiteralPath $f.FullName -Force
    Write-Host "  pruned  : $($f.Name) (older than $RetentionDays days)" -ForegroundColor DarkGray
}
