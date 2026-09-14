# Shared helpers for the AI Gateway Platform PowerShell scripts.
# Dot-source this; it defines functions only and performs no side effects.
#
# Requires PowerShell 7+.

Set-StrictMode -Version Latest

function Get-RepoRoot {
    <#
      Resolves the repository root from this script's own location, so the
      scripts work regardless of the caller's current directory.
    #>
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Get-EnvFilePath {
    param(
        [string] $EnvFile,
        [ValidateSet('dev', 'prod')]
        [string] $Environment = 'dev'
    )

    $root = Get-RepoRoot
    if ($EnvFile) {
        $candidate = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $root $EnvFile }
    } else {
        $candidate = Join-Path $root "deploy/.env.$Environment"
    }
    return $candidate
}

function Read-EnvFile {
    <#
      Parses a docker-compose style env file into an ordered hashtable.
      Ignores blank lines and `#` comments. Does not perform interpolation.
    #>
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Env file not found: $Path"
    }

    $map = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
        $idx = $trimmed.IndexOf('=')
        if ($idx -lt 1) { continue }
        $key = $trimmed.Substring(0, $idx).Trim()
        $val = $trimmed.Substring($idx + 1).Trim()
        $map[$key] = $val
    }
    return $map
}

function Assert-NoPlaceholders {
    <#
      Refuses to continue when an env file still contains generated-secret
      placeholders. Starting a stack on `REPLACE_ME_...` would either fail
      opaquely or, worse, come up with a predictable credential.
    #>
    param([Parameter(Mandatory)][string] $Path)

    $bad = @()
    $map = Read-EnvFile -Path $Path
    foreach ($k in $map.Keys) {
        if ($map[$k] -match 'REPLACE_ME') { $bad += $k }
    }
    if ($bad.Count -gt 0) {
        throw "Env file '$Path' still has placeholder values for: $($bad -join ', ').`nRun: pwsh ./scripts/new-secrets.ps1 -EnvFile '$Path'"
    }
}

function New-RandomSecret {
    <#
      Cryptographically secure secret using RNGCryptoServiceProvider-backed
      RandomNumberGenerator. Returns URL-safe base64 without padding so the
      value is safe to paste into env files, DSNs and shell arguments.
      Note: Get-Random is NOT used — it is not cryptographically secure.
    #>
    param([int] $Bytes = 48)

    $buf = [byte[]]::new($Bytes)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buf)
    return [Convert]::ToBase64String($buf).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

function Get-ComposeArgs {
    <#
      Builds the docker compose argument list for an environment.
      Keeping this in one place stops the scripts from drifting apart and
      accidentally targeting the wrong project/volumes.
    #>
    param(
        [Parameter(Mandatory)][string] $EnvFilePath,
        [ValidateSet('dev', 'prod')]
        [string] $Environment = 'dev'
    )

    $root = Get-RepoRoot
    return @('compose', '--env-file', $EnvFilePath, '-f', (Join-Path $root "deploy/compose.$Environment.yaml"))
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory)][string[]] $ComposeArgs,
        [Parameter(Mandatory)][string[]] $Command
    )

    $all = $ComposeArgs + $Command
    Write-Host "docker $($all -join ' ')" -ForegroundColor DarkGray
    & docker @all
    return $LASTEXITCODE
}

function Assert-DockerEngine {
    <#
      Fails fast with an actionable message instead of letting every
      subsequent docker call hang for minutes on a dead engine.
    #>
    $job = Start-Job { docker info --format '{{.ServerVersion}}' 2>&1 }
    $done = Wait-Job $job -Timeout 30
    $out = if ($done) { Receive-Job $job } else { $null }
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue

    if (-not $done -or "$out" -notmatch '^\d+\.') {
        throw @"
Docker engine is not responding.

Checks, in order:
  1. Get-Service com.docker.service          # must be Running (needs admin to start)
  2. wsl --list --verbose                    # 'docker-desktop' must not be Stopped
  3. Stale AF_UNIX sockets block startup. With Docker Desktop closed, move aside:
       %LOCALAPPDATA%\Docker\run
       %LOCALAPPDATA%\docker-secrets-engine
     They contain only sockets and are recreated on launch.
  4. Check the tail of:
       %LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log
"@
    }
}

function Get-ProjectName {
    param([Parameter(Mandatory)][string] $EnvFilePath)

    $map = Read-EnvFile -Path $EnvFilePath
    if ($map.Contains('COMPOSE_PROJECT_NAME') -and $map['COMPOSE_PROJECT_NAME']) {
        return $map['COMPOSE_PROJECT_NAME']
    }
    return 'ai-gateway-dev'
}
