<#
.SYNOPSIS
    Prevents new frontend lint debt without pretending the inherited debt is
    already fixed.

.DESCRIPTION
    The fork inherited a large number of oxlint violations from upstream. Two
    obvious responses are both wrong:

      - enforce lint immediately: every product PR goes red for reasons that
        have nothing to do with its change, so the signal gets ignored
      - disable lint, or relax rules until it passes: destroys the signal
        permanently

    So instead this records a per-file baseline and enforces a ratchet:

      - a file may not exceed its recorded violation count
      - a file with no baseline entry must have zero violations
      - the total may never increase
      - counts that go down are reported, and -Update lowers the baseline

    Because the baseline is per file, editing an untouched legacy file is
    still allowed to leave its existing violations alone, while any file you
    actually work on cannot get worse.

.PARAMETER Update
    Rewrite the baseline from the current state. Refuses to raise any count
    unless -AllowIncrease is also passed, so the ratchet cannot be loosened by
    accident.

.PARAMETER AllowIncrease
    Permit -Update to record higher counts. Requires a deliberate choice.

.EXAMPLE
    pwsh ./scripts/lint-guard.ps1            # check
    pwsh ./scripts/lint-guard.ps1 -Update    # after fixing violations
#>
[CmdletBinding()]
param(
    [switch] $Update,
    [switch] $AllowIncrease
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
$webDir = Join-Path $root 'web'
$baselinePath = Join-Path $root 'web/.oxlint-baseline.json'

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    $candidate = Join-Path $env:USERPROFILE '.bun/bin/bun.exe'
    if (Test-Path -LiteralPath $candidate) {
        $env:PATH = "$(Split-Path $candidate);$env:PATH"
    } else {
        throw "bun is not installed. Install it with: irm bun.sh/install.ps1 | iex"
    }
}

Write-Host "Running oxlint..." -ForegroundColor Cyan
Push-Location $webDir
try {
    # oxlint exits non-zero when violations exist, which is expected here.
    $raw = & bunx oxlint -c .oxlintrc.json --format json . 2>$null | Out-String
} finally {
    Pop-Location
}

if (-not $raw.Trim()) { throw "oxlint produced no output; cannot evaluate lint state." }

$report = $raw | ConvertFrom-Json
$diagnostics = @($report.diagnostics)

# Count per file, normalising to forward slashes so Windows and Linux CI
# produce identical keys.
$current = @{}
foreach ($d in $diagnostics) {
    $file = "$($d.filename)" -replace '\\', '/'
    if (-not $file) { continue }
    if ($current.ContainsKey($file)) { $current[$file]++ } else { $current[$file] = 1 }
}

$currentTotal = $diagnostics.Count
$errorCount = @($diagnostics | Where-Object { $_.severity -eq 'error' }).Count
$warningCount = @($diagnostics | Where-Object { $_.severity -eq 'warning' }).Count

Write-Host "Current: $currentTotal violations across $($current.Keys.Count) files ($errorCount errors, $warningCount warnings)" -ForegroundColor DarkGray

# ── Update mode ──────────────────────────────────────────────────────────────
if ($Update) {
    if (Test-Path -LiteralPath $baselinePath) {
        $old = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
        $oldFiles = @{}
        foreach ($p in $old.files.PSObject.Properties) { $oldFiles[$p.Name] = [int]$p.Value }

        $raised = @()
        foreach ($f in $current.Keys) {
            $before = if ($oldFiles.ContainsKey($f)) { $oldFiles[$f] } else { 0 }
            if ($current[$f] -gt $before) { $raised += "$f ($before -> $($current[$f]))" }
        }
        if ($raised.Count -gt 0 -and -not $AllowIncrease) {
            Write-Host "Refusing to update: this would RAISE the baseline for:" -ForegroundColor Red
            $raised | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
            Write-Host "Fix the new violations, or pass -AllowIncrease if this is genuinely intended." -ForegroundColor Yellow
            exit 1
        }
    }

    $ordered = [ordered]@{}
    foreach ($f in ($current.Keys | Sort-Object)) { $ordered[$f] = $current[$f] }

    $payload = [ordered]@{
        '_comment'   = 'Inherited oxlint debt from upstream New API. Enforced as a ratchet by scripts/lint-guard.ps1: counts may fall, never rise. Do not hand-edit.'
        'generated'  = (Get-Date -Format 'yyyy-MM-dd')
        'upstream'   = 'v1.0.0-rc.22'
        'total'      = $currentTotal
        'errors'     = $errorCount
        'warnings'   = $warningCount
        'files'      = $ordered
    }
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $baselinePath -Encoding utf8NoBOM
    Write-Host "Baseline written: $baselinePath ($currentTotal violations)" -ForegroundColor Green
    exit 0
}

# ── Check mode ───────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $baselinePath)) {
    throw "No baseline at $baselinePath. Create one with: pwsh ./scripts/lint-guard.ps1 -Update"
}

$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
$baseFiles = @{}
foreach ($p in $baseline.files.PSObject.Properties) { $baseFiles[$p.Name] = [int]$p.Value }

$regressions = @()
$improvements = @()

foreach ($f in ($current.Keys | Sort-Object)) {
    $allowed = if ($baseFiles.ContainsKey($f)) { $baseFiles[$f] } else { 0 }
    if ($current[$f] -gt $allowed) {
        $regressions += [pscustomobject]@{ File = $f; Allowed = $allowed; Actual = $current[$f] }
    }
}
foreach ($f in ($baseFiles.Keys | Sort-Object)) {
    $now = if ($current.ContainsKey($f)) { $current[$f] } else { 0 }
    if ($now -lt $baseFiles[$f]) {
        $improvements += [pscustomobject]@{ File = $f; Was = $baseFiles[$f]; Now = $now }
    }
}

foreach ($i in $improvements) {
    Write-Host ("[better] {0}: {1} -> {2}" -f $i.File, $i.Was, $i.Now) -ForegroundColor Green
}

if ($regressions.Count -gt 0) {
    Write-Host ""
    Write-Host "NEW LINT DEBT - $($regressions.Count) file(s) exceed the baseline:" -ForegroundColor Red
    foreach ($r in $regressions) {
        Write-Host ("  {0}: allowed {1}, found {2}" -f $r.File, $r.Allowed, $r.Actual) -ForegroundColor Red
        foreach ($d in ($diagnostics | Where-Object { ("$($_.filename)" -replace '\\', '/') -eq $r.File } | Select-Object -First 5)) {
            $loc = if ($d.labels -and $d.labels.Count -gt 0) { " (offset $($d.labels[0].span.offset))" } else { '' }
            Write-Host ("      [{0}] {1}{2}" -f $d.code, $d.message, $loc) -ForegroundColor DarkRed
        }
    }
    Write-Host ""
    Write-Host "Fix these before merging. Do not run -Update to paper over them." -ForegroundColor Yellow
    exit 1
}

if ($currentTotal -gt [int]$baseline.total) {
    Write-Host "Total violations rose from $($baseline.total) to $currentTotal." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "No new lint debt. $currentTotal violations, baseline allows $($baseline.total)." -ForegroundColor Green
if ($improvements.Count -gt 0) {
    Write-Host "$($improvements.Count) file(s) improved - run with -Update to lower the baseline." -ForegroundColor Cyan
}
exit 0
