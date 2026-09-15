<#
.SYNOPSIS
Runs the official Claude Code executable against an isolated HYC AI endpoint.

.DESCRIPTION
Reads a project-local env file and starts Claude Code with a child-only
environment. It never changes the PowerShell profile, CC Switch, user Claude
settings, or persistent environment variables. OpenRouter endpoints and keys
are rejected.
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [string] $Print,
    [ValidateRange(1, 900)]
    [int] $TimeoutSeconds = 180,
    [switch] $Minimal,
    [string] $WorkingDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-RepoRoot
if (-not $EnvFile) { $EnvFile = Join-Path $root 'deploy/.env.hyc-client.local' }
$resolvedEnv = [IO.Path]::GetFullPath($EnvFile)
if (-not (Test-Path -LiteralPath $resolvedEnv)) {
    throw "HYC client env file not found. Copy deploy/.env.hyc-client.example to deploy/.env.hyc-client.local."
}
$config = Read-EnvFile -Path $resolvedEnv
$allowedKeys = @('HYC_API_BASE_URL', 'HYC_API_TOKEN', 'HYC_PUBLIC_MODEL')
$unexpectedKeys = @($config.Keys | Where-Object { $_ -notin $allowedKeys })
if ($unexpectedKeys.Count -gt 0) { throw "Unsupported HYC client setting(s): $($unexpectedKeys -join ', ')" }

$baseUrl = "$($config['HYC_API_BASE_URL'])".Trim().TrimEnd('/')
$token = "$($config['HYC_API_TOKEN'])".Trim()
$model = "$($config['HYC_PUBLIC_MODEL'])".Trim()
if (-not $baseUrl -or -not $token -or -not $model) { throw 'HYC_API_BASE_URL, HYC_API_TOKEN and HYC_PUBLIC_MODEL are required.' }
if ($baseUrl -match '(?i)openrouter\.ai') { throw 'Claude Code must connect to HYC AI, never directly to OpenRouter.' }
if ($baseUrl -notmatch '^https?://') { throw 'HYC_API_BASE_URL must use http:// or https://.' }
if ($model -ne 'claude-opus-4.6') { throw 'HYC_PUBLIC_MODEL must be the approved public alias claude-opus-4.6.' }

$npmPrefix = @(& npm prefix -g 2>$null) -join ''
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($npmPrefix)) { throw 'Could not resolve the global npm prefix.' }
$nativeClaude = Join-Path $npmPrefix 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'
if (-not (Test-Path -LiteralPath $nativeClaude)) { throw 'Official Claude Code native executable is missing from the global package.' }

if (-not $WorkingDirectory) { $WorkingDirectory = $root }
$resolvedWorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
if (-not (Test-Path -LiteralPath $resolvedWorkingDirectory -PathType Container)) { throw 'Claude Code working directory does not exist.' }

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $nativeClaude
$startInfo.WorkingDirectory = $resolvedWorkingDirectory
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.CreateNoWindow = $true

$childEnvironment = @{
    ANTHROPIC_BASE_URL = $baseUrl
    ANTHROPIC_AUTH_TOKEN = $token
    ANTHROPIC_API_KEY = ''
    ANTHROPIC_MODEL = $model
    ANTHROPIC_DEFAULT_OPUS_MODEL = $model
    ANTHROPIC_DEFAULT_SONNET_MODEL = $model
    ANTHROPIC_DEFAULT_HAIKU_MODEL = $model
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    DISABLE_TELEMETRY = '1'
    DISABLE_ERROR_REPORTING = '1'
    DISABLE_BUG_COMMAND = '1'
    DISABLE_AUTOUPDATER = '1'
    # Claude Code defaults to a 32K output ceiling. Bound it for this route so
    # short CLI turns match the already-proven HYC Messages request envelope.
    CLAUDE_CODE_MAX_OUTPUT_TOKENS = '4096'
    CLAUDE_CODE_USE_BEDROCK = ''
    CLAUDE_CODE_USE_VERTEX = ''
    CLAUDE_CODE_USE_FOUNDRY = ''
}
if ($Minimal) {
    # Claude Code 2.1.220 otherwise attaches a near-maximal thinking budget even
    # with --effort low. The minimal compatibility probe must stay cheap and
    # isolate the base Messages/SSE path.
    $childEnvironment['CLAUDE_CODE_DISABLE_THINKING'] = '1'
} else {
    # Keep thinking available for normal project runs, but bound it so the CLI
    # cannot silently turn a short request into a 32K-token reasoning request.
    $childEnvironment['MAX_THINKING_TOKENS'] = '1024'
}
foreach ($entry in $childEnvironment.GetEnumerator()) { $startInfo.Environment[$entry.Key] = $entry.Value }

if ($PSBoundParameters.ContainsKey('Print')) {
    $startInfo.ArgumentList.Add('-p')
    $startInfo.ArgumentList.Add('--output-format')
    $startInfo.ArgumentList.Add('json')
    $startInfo.ArgumentList.Add('--max-turns')
    $startInfo.ArgumentList.Add('1')
    $startInfo.ArgumentList.Add('--no-session-persistence')
}
$startInfo.ArgumentList.Add('--setting-sources')
$startInfo.ArgumentList.Add('local')
$startInfo.ArgumentList.Add('--model')
$startInfo.ArgumentList.Add($model)
if ($Minimal) {
    $startInfo.ArgumentList.Add('--strict-mcp-config')
    $startInfo.ArgumentList.Add('--tools')
    $startInfo.ArgumentList.Add('')
    $startInfo.ArgumentList.Add('--system-prompt')
    $startInfo.ArgumentList.Add('Return only the requested short text.')
    $startInfo.ArgumentList.Add('--effort')
    $startInfo.ArgumentList.Add('low')
}
if ($PSBoundParameters.ContainsKey('Print')) { $startInfo.ArgumentList.Add($Print) }

$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$processStarted = $false
try {
    if (-not $process.Start()) { throw 'Claude Code process did not start.' }
    $processStarted = $true
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill($true)
        $process.WaitForExit()
        [Console]::Error.WriteLine("Claude Code timed out after $TimeoutSeconds seconds.")
        exit 124
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($stdout) { [Console]::Out.Write($stdout.Replace($token, '[HYC_TOKEN_REDACTED]')) }
    if ($stderr) { [Console]::Error.Write($stderr.Replace($token, '[HYC_TOKEN_REDACTED]')) }
    exit $process.ExitCode
} finally {
    if ($processStarted -and -not $process.HasExited) {
        try {
            $process.Kill($true)
            $process.WaitForExit()
        } catch {
            # Best-effort cleanup during Ctrl+C or another terminating exception.
        }
    }
    $token = $null
    $childEnvironment['ANTHROPIC_AUTH_TOKEN'] = ''
    $startInfo.Environment['ANTHROPIC_AUTH_TOKEN'] = ''
    $process.Dispose()
}
