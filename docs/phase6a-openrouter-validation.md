# Phase 6A — OpenRouter validation

**Status:** core validated; Responses validated as a non-core Beta surface
**Date:** 2026-07-31
**Branch:** `feature/phase6a-openrouter`
**Starting commit:** `5e4010f31efe595289f705c82060ae356af10cd2`

## Scope and decision

Phase 6A selects OpenRouter as the only active upstream direction. The public
model is `claude-opus-4.6` (`Claude Opus 4.6`); its private channel mapping
targets `anthropic/claude-opus-4.6`. No fallback model, auto router, second
adapter, production channel, UI change, or Phase 6B work is included.

The existing OpenAI-compatible adapter is reused. With the channel base URL
`https://openrouter.ai/api`, its path rules produce exactly:

- `/api/v1/chat/completions` for Chat Completions;
- `/api/v1/chat/completions` for inbound Anthropic Messages after the existing
  Messages-to-Chat conversion;
- `/api/v1/responses` for Responses.

Unit tests pin these paths and reject duplicate `/v1` segments.

## Official protocol evidence

The implementation was checked against OpenRouter's official documentation:

- [Chat Completions API](https://openrouter.ai/docs/api-reference/chat-completion)
- [Anthropic Messages API](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages?explorer=true)
- [Responses API overview](https://openrouter.ai/docs/api/reference/responses/overview)
- [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [Current key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)
- [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [Errors and debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging)

The official schemas and live calls confirmed that the `provider` object is
accepted on Chat, Messages, and Responses. The server overwrites any value with:

```json
{
  "data_collection": "deny",
  "zdr": true,
  "require_parameters": true
}
```

`provider.order` is intentionally absent. Response metadata remains disabled.

## Direct live probe

`scripts/probe-openrouter.ps1` runs in fixed levels, stores sanitized summaries
under Git-ignored `.local-tests/openrouter`, and never prints or persists the
key or complete upstream response.

| Level | Result | Evidence |
| --- | --- | --- |
| 0 | pass | key valid; limit `$2`; starting usage `$0`; target present in Models; supported parameters present; invalid key returned 401 |
| 1 | pass | Chat buffered/SSE and Messages buffered/SSE returned 200 with usage and identifiable model |
| 2 | pass | system, tools, tool results, prompt-cache write/read, reasoning, stop reason, cancellation and timeout |
| 3 | pass | Responses buffered/SSE returned 200; provider privacy policy accepted |

Unsafe real failures were not manufactured. Statuses 402, 403, 408, 429, 502
and 503, plus `Retry-After`, are classified by deterministic offline tests.

## HYC AI live validation

The platform probe creates an isolated, short-lived `provider-spike` user and
model-limited token, then deletes both. A detected Windows system proxy is
stored only in the development channel because the direct and Go processes
otherwise had different egress-region decisions. Its address is suppressed.

Verified through `http://127.0.0.1:3001`:

- `/v1/models` returned exactly the public alias with owner `hyc-ai`;
- Chat buffered and SSE, including system prompt and usage;
- Messages buffered and SSE, including stop reason and usage;
- tool use and tool-result continuation;
- prompt caching: 4,502 write tokens followed by 4,502 read tokens;
- reasoning: a Messages thinking block and 21 output tokens;
- Responses buffered and SSE (Beta, non-core);
- every public response model and streamed model used `claude-opus-4.6`;
- upstream generation/request IDs and `x-openrouter-*` headers were absent;
- user `provider` controls and the private model slug were rejected without
  changing token usage;
- a client-aborted SSE request was observed and settled through the existing
  billing lifecycle;
- five quick-probe consumption logs contained the public alias and no channel
  ID, channel name, upstream request ID, upstream model, URL, or provider name.

The final account snapshot after all direct, diagnostic and platform calls was
`usage=$0.1542845`, `limit_remaining=$1.8457155`; the total stayed below the
`$0.20` hard ceiling.

## Client status

- Claude Code: **minimal native path verified by Phase 6A.2**. The generic 500
  was an HYC validation bug: the OpenRouter routing guard rejected legitimate
  Anthropic `metadata` before upstream I/O. The format-scoped fix accepts and
  drops that client-only field. Official Claude Code 2.1.220 then completed a
  real HYC → OpenRouter request with the public alias, one private usage log,
  and `$0.0000000` measured Phase 6A.2 spend.
- Cursor: **unverified**. Cursor 3.13.25 is installed, but the available CLI
  does not expose a non-interactive agent invocation suitable for an isolated
  Base URL/token test. Chat/SSE/tools compatibility is validated at API level.

Long-session and client stress tests require a later explicit approval. They
are not launch claims and are not Phase 6B work.

Phase 6A.1 replaces the historical paid default smoke with a loopback-only
deterministic relay regression and records release/network/cost gates in
`docs/phase6a1-client-compatibility.md`,
`docs/phase6a2-claude-code-compatibility.md`,
`docs/openrouter-release-readiness.md`, and
`docs/openrouter-production-network.md`.
