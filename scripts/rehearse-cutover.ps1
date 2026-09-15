<#
.SYNOPSIS
    Full cutover rehearsal: real baseline data, real migration, real request.

.DESCRIPTION
    Answers the question a `pg_restore --list` cannot: will the production
    dataset survive the version jump, and does the service still bill and log
    correctly afterwards.

    Sequence:
      1. take a fresh backup of the baseline (rc.16) database  [READ ONLY]
      2. restore it into a scratch database inside the PLATFORM postgres
      3. record pre-migration row counts for the tables that matter
      4. run the current rc.22 binary against the scratch database so its
         AutoMigrate executes for real
      5. compare schema and row counts before/after
      6. issue a real relay request using a token from the migrated data
      7. confirm a consumption log was written and quota moved
      8. drop the scratch database

    Safety:
      - the baseline database is only ever read (pg_dump, SELECT)
      - the scratch database lives in the platform container, never the
        baseline one, and is dropped at the end
      - no Docker volume is created, mounted or removed
      - the scratch instance listens on its own port, so the normal dev API is
        untouched

.PARAMETER KeepScratch
    Leave the scratch database in place for manual inspection.

.EXAMPLE
    pwsh ./scripts/rehearse-cutover.ps1
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [string] $BaselineContainer = 'new-api-dev-postgres-1',
    [int] $Port = 3150,
    [switch] $KeepScratch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

Assert-DockerEngine

$root = Get-RepoRoot
$envPath = Get-EnvFilePath -EnvFile $EnvFile -Environment 'dev'
$map = Read-EnvFile -Path $envPath
$composeArgs = Get-ComposeArgs -EnvFilePath $envPath -Environment 'dev'

$pgId = (& docker @($composeArgs + @('ps', '-q', 'postgres')) 2>$null | Select-Object -First 1)
if (-not $pgId) { throw "platform postgres is not running. Run scripts/dev-up.ps1 first." }

$scratch = "cutover_rehearsal_$(Get-Date -Format 'yyyyMMddHHmmss')"
$report = [ordered]@{}
$stepNo = 0
function Step { param([string] $Text) $script:stepNo++; Write-Host ""; Write-Host "[$script:stepNo] $Text" -ForegroundColor Cyan }

Write-Host "Cutover rehearsal" -ForegroundColor Cyan
Write-Host "  source (read-only) : $BaselineContainer" -ForegroundColor DarkGray
Write-Host "  scratch database   : $scratch (in platform postgres)" -ForegroundColor DarkGray
Write-Host ("=" * 78)

try {
    # ── 1. Back up the baseline (read-only against it) ───────────────────────
    Step "Backing up baseline database (read-only)"
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dumpName = "cutover-source-$stamp.dump"
    & docker exec $BaselineContainer sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -Fc -f '/tmp/$dumpName'"
    if ($LASTEXITCODE -ne 0) { throw "pg_dump of baseline failed" }

    $backupDir = Join-Path $root 'deploy/backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $localDump = Join-Path $backupDir $dumpName
    & docker cp "${BaselineContainer}:/tmp/$dumpName" $localDump
    & docker exec $BaselineContainer rm -f "/tmp/$dumpName" | Out-Null
    if (-not (Test-Path -LiteralPath $localDump)) { throw "backup file was not produced" }
    $report['rollback_point'] = $localDump
    Write-Host "    rollback point: $localDump ($([math]::Round((Get-Item $localDump).Length/1KB,1)) KB)" -ForegroundColor Green

    # ── 2. Pre-migration counts, read from the source ────────────────────────
    Step "Recording pre-migration state (source, rc.16)"
    $countQuery = "select (select count(*) from pg_tables where schemaname='public'), (select count(*) from users), (select count(*) from tokens), (select count(*) from channels), (select count(*) from logs), (select coalesce(sum(quota),0) from users);"
    $before = (& docker exec $BaselineContainer sh -c "psql -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -tAF'|' -c `"$countQuery`"" 2>$null)
    $b = "$before".Trim() -split '\|'
    $report['before'] = [ordered]@{ tables = $b[0]; users = $b[1]; tokens = $b[2]; channels = $b[3]; logs = $b[4]; quota_sum = $b[5] }
    Write-Host "    tables=$($b[0]) users=$($b[1]) tokens=$($b[2]) channels=$($b[3]) logs=$($b[4]) quota_sum=$($b[5])" -ForegroundColor DarkGray

    # ── 3. Restore into the scratch database (platform container) ────────────
    Step "Restoring into scratch database '$scratch'"
    & docker cp $localDump "${pgId}:/tmp/$dumpName" | Out-Null
    & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d postgres -c 'CREATE DATABASE $scratch;'" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not create scratch database" }

    # --no-owner/--no-acl: the source roles do not exist in this cluster.
    & docker exec $pgId sh -c "pg_restore -U `"`$POSTGRES_USER`" -d $scratch --no-owner --no-acl '/tmp/$dumpName'" 2>&1 | Out-Null
    & docker exec $pgId rm -f "/tmp/$dumpName" | Out-Null

    $restored = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAF'|' -c `"$countQuery`"" 2>$null)
    $r = "$restored".Trim() -split '\|'
    Write-Host "    restored: tables=$($r[0]) users=$($r[1]) tokens=$($r[2]) channels=$($r[3]) logs=$($r[4])" -ForegroundColor DarkGray
    if ($r[1] -ne $b[1] -or $r[2] -ne $b[2] -or $r[3] -ne $b[3]) {
        throw "restore lost rows: users $($b[1])->$($r[1]), tokens $($b[2])->$($r[2]), channels $($b[3])->$($r[3])"
    }
    Write-Host "    row counts match source" -ForegroundColor Green

    # ── 4. Run the current version against it, triggering AutoMigrate ────────
    Step "Starting rc.22 binary against the scratch database (port $Port)"
    $bin = Join-Path $root '.platform-tmp/ai-gateway.exe'
    if (-not (Test-Path -LiteralPath $bin)) { throw "binary not built: $bin. Run scripts/dev-backend.ps1 once." }

    try {
        $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $l.Start(); $l.Stop()
    } catch {
        throw "port $Port is not bindable: $($_.Exception.Message). Pick another with -Port."
    }

    $pgPort = $map['PLATFORM_POSTGRES_HOST_PORT']
    $rdPort = $map['PLATFORM_REDIS_HOST_PORT']
    $envs = @{
        SQL_DSN                = "postgresql://$($map['POSTGRES_USER']):$($map['POSTGRES_PASSWORD'])@127.0.0.1:$pgPort/$scratch`?sslmode=disable"
        # Separate Redis logical DB so the rehearsal cannot disturb dev cache state.
        REDIS_CONN_STRING      = "redis://:$($map['REDIS_PASSWORD'])@127.0.0.1:$rdPort/3"
        PORT                   = "$Port"
        BIND_ADDRESS           = '127.0.0.1'
        SESSION_SECRET         = $map['SESSION_SECRET']
        CRYPTO_SECRET          = $map['CRYPTO_SECRET']
        GIN_MODE               = 'release'
        GENERATE_DEFAULT_TOKEN = 'false'
        TRUSTED_PROXIES        = 'none'
        NODE_NAME              = 'cutover-rehearsal'
        NODE_TYPE              = 'master'
    }
    $envAssign = ($envs.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }) -join '; '
    $logFile = Join-Path $root ".platform-tmp/cutover-rehearsal.log"
    $proc = Start-Process -FilePath 'pwsh' -ArgumentList '-NoProfile', '-Command', "$envAssign; & '$bin' --log-dir '$(Join-Path $root ".platform-tmp/cutover-logs")'" -PassThru -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"

    $ready = $false
    foreach ($i in 1..40) {
        Start-Sleep -Seconds 3
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 5
            if ($resp.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        if ($proc.HasExited) { break }
    }
    if (-not $ready) {
        Write-Host "    migration log tail:" -ForegroundColor Red
        Get-Content $logFile -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkRed }
        throw "rc.22 did not become healthy against the migrated database"
    }
    Write-Host "    service healthy on migrated data" -ForegroundColor Green

    # ── 5. Post-migration schema and data ───────────────────────────────────
    Step "Verifying post-migration schema and data"
    $after = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAF'|' -c `"$countQuery`"" 2>$null)
    $a = "$after".Trim() -split '\|'
    $report['after'] = [ordered]@{ tables = $a[0]; users = $a[1]; tokens = $a[2]; channels = $a[3]; logs = $a[4]; quota_sum = $a[5] }
    Write-Host "    tables=$($a[0]) (was $($b[0]))  users=$($a[1])  tokens=$($a[2])  channels=$($a[3])  logs=$($a[4])  quota_sum=$($a[5])" -ForegroundColor DarkGray

    if ([int]$a[1] -ne [int]$b[1]) { throw "user rows changed during migration: $($b[1]) -> $($a[1])" }
    if ([int]$a[2] -ne [int]$b[2]) { throw "token rows changed during migration: $($b[2]) -> $($a[2])" }
    if ([int]$a[3] -ne [int]$b[3]) { throw "channel rows changed during migration: $($b[3]) -> $($a[3])" }
    if ([int]$a[5] -ne [int]$b[5]) { throw "total user quota changed during migration: $($b[5]) -> $($a[5])" }
    Write-Host "    users, tokens, channels and total quota preserved exactly" -ForegroundColor Green

    $newTables = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc `"select tablename from pg_tables where schemaname='public' and tablename in ('auth_flows','external_identity_claims','user_sessions') order by tablename;`"" 2>$null)
    $report['new_tables'] = (@("$newTables".Trim() -split '\r?\n') | Where-Object { $_ }) -join ', '
    Write-Host "    migration added: $($report['new_tables'])" -ForegroundColor Green

    # ── 6. Real request through the migrated data ───────────────────────────
    Step "Issuing a real relay request using migrated credentials"
    $tokenKey = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc `"select key from tokens where status=1 and (expired_time=-1 or expired_time>extract(epoch from now())) order by id limit 1;`"" 2>$null)
    $tokenKey = "$tokenKey".Trim()

    $modelName = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc `"select split_part(models,',',1) from channels where status=1 order by id limit 1;`"" 2>$null)
    $modelName = "$modelName".Trim()

    if (-not $tokenKey) {
        $report['relay'] = 'SKIPPED - no active token in migrated data'
        Write-Host "    no usable token in the migrated dataset; relay check skipped" -ForegroundColor Yellow
    } else {
        $logsBefore = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc 'select count(*) from logs;'" 2>$null)
        $body = @{ model = $modelName; messages = @(@{ role = 'user'; content = 'Reply with exactly: CUTOVER_OK' }); stream = $false; max_tokens = 32 } | ConvertTo-Json -Depth 5
        try {
            $chat = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/chat/completions" -Method POST -Body $body -ContentType 'application/json' -Headers @{ Authorization = "Bearer sk-$tokenKey" } -TimeoutSec 120
            $reply = "$($chat.choices[0].message.content)".Trim()
            $report['relay'] = "OK model=$modelName tokens=$($chat.usage.total_tokens) reply='$reply'"
            Write-Host "    relay OK: model=$modelName tokens=$($chat.usage.total_tokens) reply='$reply'" -ForegroundColor Green
        } catch {
            $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
            $report['relay'] = "FAILED: $detail"
            Write-Host "    relay FAILED: $detail" -ForegroundColor Red
        }

        # ── 7. Logging and billing after migration ──────────────────────────
        Step "Confirming logging and billing still work post-migration"
        Start-Sleep -Seconds 6
        $logsAfter = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc 'select count(*) from logs;'" 2>$null)
        $usedAfter = (& docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d $scratch -tAc `"select used_quota from tokens where key='$tokenKey';`"" 2>$null)
        $delta = [int]"$logsAfter".Trim() - [int]"$logsBefore".Trim()
        $report['log_delta'] = $delta
        $report['token_used_quota_after'] = "$usedAfter".Trim()
        $color = if ($delta -gt 0) { 'Green' } else { 'Red' }
        Write-Host "    consumption logs written: $delta (before=$("$logsBefore".Trim()) after=$("$logsAfter".Trim()))" -ForegroundColor $color
        Write-Host "    token used_quota now: $("$usedAfter".Trim())" -ForegroundColor $color
    }

    # ── 8. Stop the rehearsal instance ──────────────────────────────────────
    Step "Stopping rehearsal instance"
    # $proc is the pwsh wrapper, not the Go binary it launched. Killing only
    # the wrapper orphans ai-gateway.exe, which then keeps holding $Port and
    # a connection pool to a database this script is about to drop. That
    # actually happened: an orphan survived 23 hours on port 3150.
    # Kill the child first, then the wrapper, then verify the port is free.
    $orphans = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue)
    foreach ($child in $orphans) {
        Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2

    # Belt and braces: anything still bound to the rehearsal port is ours.
    $stillBound = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    foreach ($conn in $stillBound) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1

    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "    WARNING: port $Port is still bound; a rehearsal process may be orphaned." -ForegroundColor Red
    } else {
        Write-Host "    stopped; port $Port released" -ForegroundColor DarkGray
    }

} finally {
    if (-not $KeepScratch) {
        Write-Host ""
        Write-Host "Cleaning up scratch database..." -ForegroundColor DarkGray
        # Terminate stragglers so DROP cannot block.
        & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d postgres -c `"select pg_terminate_backend(pid) from pg_stat_activity where datname='$scratch';`"" 2>&1 | Out-Null
        & docker exec $pgId sh -c "psql -U `"`$POSTGRES_USER`" -d postgres -c 'DROP DATABASE IF EXISTS $scratch;'" 2>&1 | Out-Null
        Write-Host "  scratch database dropped. No volume was created or removed." -ForegroundColor DarkGray
    } else {
        Write-Host "Scratch database kept: $scratch" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host ("=" * 78)
Write-Host "Rehearsal summary" -ForegroundColor Cyan
foreach ($k in $report.Keys) {
    $v = $report[$k]
    if ($v -is [System.Collections.Specialized.OrderedDictionary]) {
        Write-Host ("  {0,-24} {1}" -f $k, (($v.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '))
    } else {
        Write-Host ("  {0,-24} {1}" -f $k, $v)
    }
}
