<#
.SYNOPSIS
Runs the deterministic, zero-Provider-cost Relay smoke suite.

.DESCRIPTION
This compatibility entry point no longer calls a configured external channel.
It delegates to a run-scoped SQLite gateway and loopback stub, so the default
smoke cannot reach a retired upstream, OpenRouter, or a production credential.
#>
[CmdletBinding()]
param(
    [ValidateRange(0, 65535)]
    [int] $GatewayPort = 0,
    [ValidateRange(0, 65535)]
    [int] $StubPort = 0,
    [switch] $KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'dev-relay-smoke-local.ps1') -GatewayPort $GatewayPort -StubPort $StubPort -KeepArtifacts:$KeepArtifacts
exit $LASTEXITCODE
