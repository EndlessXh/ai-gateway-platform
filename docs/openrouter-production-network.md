# OpenRouter production network requirements

## Required route

The API runtime needs outbound DNS and TCP 443 to `openrouter.ai`. The selected
API base is `https://openrouter.ai/api`; inference paths add `/v1/...`. Do not
allow clients to supply an upstream URL, proxy, route or Provider key.

Run this both on the host and in the same container/network namespace as the
gateway:

```powershell
pwsh ./scripts/preflight-openrouter-egress.ps1
```

The script performs DNS, direct IPv4/IPv6 TCP/TLS diagnostics and a key-free
Models GET through the normal HTTP path. It sends no inference request, reads
no Provider credential, suppresses addresses, and exits non-zero when the
required DNS/HTTPS path is unavailable. An IPv6 warning is acceptable when a
working IPv4 or proxy HTTPS path is the deployment design.

## Transport audit

The relay uses Go's cloned default `http.Transport`: environment proxy support,
HTTP/2 attempts, a 30-second dialer fallback, 10-second TLS handshake timeout,
keepalive, bounded idle pools and configurable relay idle timeout. The overall
request timeout is `RELAY_TIMEOUT`; zero deliberately permits long streams.
Inbound request cancellation is attached to all provider requests, so client
disconnects cancel supported upstream work and billing.

OpenRouter may send SSE comment heartbeats while a model is processing. SSE
clients and intermediaries must tolerate comment lines and must not require
every event payload to be JSON. OpenRouter documents that aborting an Anthropic
stream stops supported processing and billing.

Production edge requirements:

- HTTP/1.1 upstream connection with `proxy_buffering off` for relay routes;
- no response transformation, compression buffering or CDN cache on SSE;
- `proxy_read_timeout` at least 600 seconds for relay endpoints;
- request/body and connect timeouts should fail clearly before an inference is
  accepted, while the read timeout permits long first-token latency;
- keep `Connection` handling compatible with streaming and flush chunks;
- preserve client disconnects so cancellation reaches the Go request context;
- monitor DNS, TLS, connect latency, time-to-first-byte and mid-stream closes.

The tracked nginx relay location already disables buffering and uses a
600-second read timeout. This is a configuration audit only; target-environment
`nginx -t` and an end-to-end streaming check are still required. A CDN or
Cloudflare layer must be tested for buffering and idle-timeout behavior rather
than assumed compatible.

## Proxy policy

Direct server egress is acceptable when organizational policy permits it and
the preflight passes from the runtime namespace. Otherwise configure one
operator-owned channel proxy using a supported HTTP(S) or context-cancellable
SOCKS URL. Never copy a developer's personal/TUN proxy into production.

Proxy addresses are secrets-adjacent operational configuration: do not expose
them to users or logs. Monitor the proxy and fail closed if the selected route
is unavailable. Do not silently bypass it, because that can change egress
region, privacy controls and policy compliance.

Firewall allow-list: DNS to the deployment resolver and HTTPS/TCP 443 to
`openrouter.ai` (or to the approved proxy, which then needs that destination).
Do not health-check by calling a paid model. Use the key-free Models endpoint
for network health and a separate, explicitly authorized low-token inference
for credential/model readiness.

## Container/host differences

A successful host browser or PowerShell request does not prove container
egress. DNS servers, IPv6, certificate roots, `HTTP_PROXY`/`HTTPS_PROXY`/
`NO_PROXY`, and firewall namespaces can differ. Capture only whether a proxy is
present, never its address or credentials, and repeat preflight after deploy,
proxy rotation, CA changes or network-policy changes.
