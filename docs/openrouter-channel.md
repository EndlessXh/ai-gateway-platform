# OpenRouter development channel

## Safe setup

1. Copy `deploy/.env.openrouter.example` to the Git-ignored
   `deploy/.env.openrouter.local` and set `OPENROUTER_API_KEY` locally.
2. Start the isolated development dependencies and API:

   ```powershell
   pwsh ./scripts/dev-up.ps1
   pwsh ./scripts/dev-backend.ps1
   ```

3. Run the direct probe before creating a channel:

   ```powershell
   pwsh ./scripts/probe-openrouter.ps1 -MaxLevel 3 -AllowPaidTests
   ```

4. Seed the channel only after the core direct gate passes:

   ```powershell
   pwsh ./scripts/dev-seed-openrouter-channel.ps1
   ```

5. Run the platform probe. `-Quick` skips the already-proven expensive cache,
   reasoning, tool and Responses calls:

   ```powershell
   pwsh ./scripts/probe-hyc-openrouter.ps1
   pwsh ./scripts/probe-hyc-openrouter.ps1 -Quick
   ```

Neither script prints the upstream key, HYC token, system-proxy address, or a
complete upstream response.

The normal regression is deliberately different from those live probes:

```powershell
pwsh ./scripts/dev-smoke-test.ps1
```

It uses a loopback-only deterministic upstream, an isolated gateway process
and run-scoped SQLite state. It requires no Provider key or internet access and
cannot route to the development OpenRouter channel. Use live probes only when
the release check specifically requires them and a spend ceiling is set.

## Pinned development configuration

| Field | Value |
| --- | --- |
| Channel type | `20` (existing OpenRouter/OpenAI-compatible adapter) |
| Name | `openrouter-claude-opus-4-6-dev` |
| Group | `provider-spike` |
| Base URL | `https://openrouter.ai/api` |
| Public models | `claude-opus-4.6` only |
| Mapping | `claude-opus-4.6` → `anthropic/claude-opus-4.6` |
| Catalog label | `Claude Opus 4.6` |
| Catalog provider label | `HYC AI` |

The seed is idempotent. It refuses duplicate or conflicting channels and
preserves administrator-edited catalog copy. If Windows routes OpenRouter
through a system proxy, the seed synchronizes that proxy into this development
channel without printing it. It never reads or changes `new-api-infra`.

Development ratios are internal placeholders needed to exercise billing:
model 2.5, completion 5.0, cache read 0.1 and cache creation 1.25. They do not
constitute an approved public price. `PRICING_STATUS` remains `provisional`.
As of 2026-07-31 these reproduce the Models API fields of $5 input, $25 output,
$0.50 cache-read and $6.25 cache-write per million tokens before group/rate
adjustments. This parity observation does not approve a customer price.

Before production, run `scripts/preflight-openrouter-egress.ps1` in the actual
runtime namespace and follow `docs/openrouter-production-network.md`.

## Enforced boundary

For this channel the server rejects user-supplied routing/diagnostic fields and
headers before request conversion: `provider`, `route`, `models`, `fallbacks`,
`plugins`, `transforms`, `debug`, `trace`, `session_id`,
`X-OpenRouter-Metadata`, `X-OpenRouter-Experimental-Metadata`, `HTTP-Referer`,
`X-Title`, `X-OpenRouter-Title`, and `X-Session-Id`.

OpenAI-compatible `metadata` remains rejected as a routing/diagnostic control.
Anthropic Messages `metadata` is accepted because Claude Code sends it as a
legitimate client field, then deliberately dropped by the Messages-to-Chat
converter. It never reaches OpenRouter. Differing simultaneous
`Authorization` and `x-api-key` credentials are rejected with 401.

The adapter injects the server-owned privacy policy after model mapping. Public
responses are re-encoded through typed DTOs, which removes provider extensions,
rewrites model and response IDs, and preserves usage, tools, cache accounting,
stop reasons and reasoning details. User log formatting clears channel IDs,
channel names, upstream request IDs and private model names; administrator logs
retain bounded diagnostics without credentials.

This boundary prevents direct API/header/error/log disclosure. It does not and
cannot claim to prevent statistical model fingerprinting.
