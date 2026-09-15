<#
.SYNOPSIS
Checks the network path to OpenRouter without making an inference request.

.DESCRIPTION
Resolves the API host, attempts direct TCP/TLS diagnostics, and performs a
key-free GET of the public Models endpoint through the machine's normal HTTP
transport. No provider credential is read or sent. Proxy locations and remote
addresses are deliberately suppressed.
#>
[CmdletBinding()]
param(
    [int] $TimeoutSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostName = 'openrouter.ai'
$modelsUri = [Uri]'https://openrouter.ai/api/v1/models'
$results = [Collections.Generic.List[object]]::new()

function Add-Result {
    param([string] $Name, [string] $Status, [string] $Detail)
    $script:results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
    $colour = switch ($Status) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } default { 'Red' } }
    Write-Host ("[{0,-4}] {1,-28} {2}" -f $Status, $Name, $Detail) -ForegroundColor $colour
}

function Test-DirectTls {
    param([Net.IPAddress] $Address)
    $client = [Net.Sockets.TcpClient]::new($Address.AddressFamily)
    try {
        $connect = $client.ConnectAsync($Address, 443)
        if (-not $connect.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))) { throw 'connect timeout' }
        $stream = [Net.Security.SslStream]::new($client.GetStream(), $false)
        try {
            $auth = $stream.AuthenticateAsClientAsync($hostName)
            if (-not $auth.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))) { throw 'TLS handshake timeout' }
            return [pscustomobject]@{ Ok = $true; Protocol = "$($stream.SslProtocol)" }
        } finally {
            $stream.Dispose()
        }
    } catch {
        return [pscustomobject]@{ Ok = $false; Protocol = '' }
    } finally {
        $client.Dispose()
    }
}

Write-Host 'OpenRouter egress preflight (no inference, no credential)' -ForegroundColor Cyan
Write-Host ('=' * 78)

$addresses = @()
try {
    $addresses = @([Net.Dns]::GetHostAddresses($hostName))
    $v4 = @($addresses | Where-Object AddressFamily -eq InterNetwork).Count
    $v6 = @($addresses | Where-Object AddressFamily -eq InterNetworkV6).Count
    if ($addresses.Count -eq 0) { throw 'no addresses returned' }
    Add-Result 'DNS resolution' 'PASS' "A=$v4 AAAA=$v6 (addresses suppressed)"
} catch {
    Add-Result 'DNS resolution' 'FAIL' 'host could not be resolved'
}

$proxyConfigured = $false
try {
    $proxy = [Net.WebRequest]::DefaultWebProxy
    if ($null -ne $proxy) {
        $proxyUri = $proxy.GetProxy($modelsUri)
        $proxyConfigured = $null -ne $proxyUri -and $proxyUri.AbsoluteUri -ne $modelsUri.AbsoluteUri
    }
} catch {
    Add-Result 'proxy discovery' 'WARN' 'system proxy state could not be determined'
}
if (@('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY') | Where-Object { -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }) {
    $proxyConfigured = $true
}
Add-Result 'proxy configuration' 'PASS' $(if ($proxyConfigured) { 'present (address suppressed)' } else { 'not detected; direct egress required' })

$families = @(
    [pscustomobject]@{ Name = 'IPv4 direct TCP/TLS'; Address = $addresses | Where-Object AddressFamily -eq InterNetwork | Select-Object -First 1 },
    [pscustomobject]@{ Name = 'IPv6 direct TCP/TLS'; Address = $addresses | Where-Object AddressFamily -eq InterNetworkV6 | Select-Object -First 1 }
)
foreach ($family in $families) {
    if ($null -eq $family.Address) {
        Add-Result $family.Name 'WARN' 'DNS returned no address for this family'
        continue
    }
    $tls = Test-DirectTls -Address $family.Address
    if ($tls.Ok) {
        Add-Result $family.Name 'PASS' "port 443 and TLS succeeded ($($tls.Protocol))"
    } else {
        Add-Result $family.Name 'WARN' $(if ($proxyConfigured) { 'direct path failed; HTTP proxy path will decide readiness' } else { 'direct port 443 or TLS failed' })
    }
}

try {
    $handler = [Net.Http.HttpClientHandler]::new()
    $client = [Net.Http.HttpClient]::new($handler)
    try {
        $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $modelsUri)
        try {
            $response = $client.Send($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead)
            try {
                $status = [int]$response.StatusCode
                if ($status -lt 200 -or $status -ge 400) { throw "unexpected HTTP status $status" }
                Add-Result 'key-free Models endpoint' 'PASS' "HTTP $status; protocol $($response.Version)"
            } finally {
                $response.Dispose()
            }
        } finally {
            $request.Dispose()
        }
    } finally {
        $client.Dispose()
        $handler.Dispose()
    }
} catch {
    Add-Result 'key-free Models endpoint' 'FAIL' 'HTTPS request failed'
}

Write-Host ('=' * 78)
$failures = @($results | Where-Object Status -eq 'FAIL')
if ($failures.Count -gt 0) {
    Write-Host "$($failures.Count) required egress check(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host 'OpenRouter egress path is ready for a separately authorized inference request.' -ForegroundColor Green
exit 0
