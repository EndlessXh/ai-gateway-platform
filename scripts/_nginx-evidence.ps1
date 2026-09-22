# Shared, deterministic evidence helpers for nginx release verification.
Set-StrictMode -Version Latest

$script:NginxEvidenceSchema = 'ai-gateway-platform.nginx-verification'
$script:NginxEvidenceVersion = 1

function Resolve-NginxConfigRoot {
    param([Parameter(Mandatory)][string] $ConfigRoot)
    if (-not (Test-Path -LiteralPath $ConfigRoot -PathType Container)) {
        throw "nginx configuration root not found: $ConfigRoot"
    }
    return (Resolve-Path -LiteralPath $ConfigRoot).Path
}

function Get-NginxConfigFiles {
    param([Parameter(Mandatory)][string] $ConfigRoot)
    $root = Resolve-NginxConfigRoot -ConfigRoot $ConfigRoot
    $main = Join-Path $root 'nginx.conf'
    $confDir = Join-Path $root 'conf.d'
    if (-not (Test-Path -LiteralPath $main -PathType Leaf)) { throw "Missing nginx config: $main" }
    if (-not (Test-Path -LiteralPath $confDir -PathType Container)) { throw "Missing nginx config directory: $confDir" }
    $files = @($main) + @(Get-ChildItem -LiteralPath $confDir -File -Filter '*.conf' | Sort-Object Name | ForEach-Object FullName)
    if ($files.Count -lt 2) { throw "No nginx conf.d/*.conf files found in: $confDir" }
    return $files
}

function Get-NginxConfigFingerprint {
    param([Parameter(Mandatory)][string] $ConfigRoot)
    $root = Resolve-NginxConfigRoot -ConfigRoot $ConfigRoot
    $files = Get-NginxConfigFiles -ConfigRoot $root
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        foreach ($file in $files) {
            $relative = [IO.Path]::GetRelativePath($root, $file).Replace('\', '/')
            $pathBytes = [Text.UTF8Encoding]::new($false).GetBytes($relative)
            $hash.TransformBlock($pathBytes, 0, $pathBytes.Length, $pathBytes, 0) | Out-Null
            $hash.TransformBlock([byte[]]@(0), 0, 1, [byte[]]@(0), 0) | Out-Null
            $bytes = [IO.File]::ReadAllBytes($file)
            $hash.TransformBlock($bytes, 0, $bytes.Length, $bytes, 0) | Out-Null
            $hash.TransformBlock([byte[]]@(0), 0, 1, [byte[]]@(0), 0) | Out-Null
        }
        $hash.TransformFinalBlock([byte[]]@(), 0, 0) | Out-Null
        return [pscustomobject]@{
            Fingerprint = 'sha256:' + [Convert]::ToHexString($hash.Hash).ToLowerInvariant()
            Files = @($files | ForEach-Object { [IO.Path]::GetRelativePath($root, $_).Replace('\', '/') })
        }
    } finally { $hash.Dispose() }
}

function New-NginxVerificationEvidence {
    param([Parameter(Mandatory)] $Fingerprint, [Parameter(Mandatory)][string] $NginxImage)
    return [ordered]@{
        schema = $script:NginxEvidenceSchema
        version = $script:NginxEvidenceVersion
        result = 'passed'
        nginxImage = $NginxImage
        configFingerprint = $Fingerprint.Fingerprint
        configFiles = @($Fingerprint.Files)
    }
}

function Write-NginxVerificationEvidence {
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Evidence, [Parameter(Mandatory)][string] $EvidencePath)
    $parent = Split-Path -Parent $EvidencePath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temp = Join-Path $parent ('.nginx-verified.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($temp, ($Evidence | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($temp, $EvidencePath, $true)
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
    }
}

function Read-NginxVerificationEvidence {
    param([Parameter(Mandatory)][string] $EvidencePath)
    try { $evidence = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Evidence is not valid JSON.' }
    if ($evidence.schema -ne $script:NginxEvidenceSchema -or [int]$evidence.version -ne $script:NginxEvidenceVersion -or $evidence.result -ne 'passed' -or [string]::IsNullOrWhiteSpace($evidence.nginxImage) -or $evidence.configFingerprint -notmatch '^sha256:[0-9a-f]{64}$' -or @($evidence.configFiles).Count -eq 0) { throw 'Evidence schema is invalid.' }
    return $evidence
}
