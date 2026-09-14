# Phase 6A.1 — client compatibility

**Status:** release preparation complete; client claims remain deliberately
bounded

**Date:** 2026-07-31
**Branch:** `feature/phase6a1-openrouter-hardening`

> Phase 6A.2 supersedes the partial Claude Code result below. The 500 was an
> HYC format-validation defect, and the minimal native live route is now
> verified. See `docs/phase6a2-claude-code-compatibility.md`.

Phase 6A.1 does not introduce another adapter or upstream. The only permitted
live route remains:

`client → HYC AI → claude-opus-4.6 → private channel mapping → OpenRouter`

## Claude Code

| Check | Result | Evidence |
| --- | --- | --- |
| Executable | verified | Official `@anthropic-ai/claude-code` 2.1.220 CLI runs through the existing wrapper. |
| Wrapper diagnosis | verified | The PowerShell profile wrapper targeted a missing native package executable. Installing only the official CLI restored that target without replacing the wrapper or user settings. |
| Gateway environment semantics | verified | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and an empty `ANTHROPIC_API_KEY` are the supported gateway shape. |
| Settings isolation | verified | `--setting-sources local` excludes user-level CC Switch model/base overrides; no user configuration was changed. |
| Native Messages + SSE parsing | verified locally | A real Claude Code process completed against the loopback native Messages stub with the public alias. |
| Real HYC client boundary | partially verified | The isolated client saw exactly one public model and reached HYC `/v1/messages`; the upstream stage returned a generic 500 before a consumption log or model charge. |
| Ordinary live completion | unverified in this phase | No successful Claude Code completion traversed OpenRouter. The failed attempt cost `$0.0000000`. |
| system, tools, tool result, prompt caching, thinking, multi-turn | protocol verified; client body unverified | These HYC/OpenRouter protocol surfaces passed in Phase 6A, but are not claimed as successful Claude Code live interactions. |
| cancellation and timeout | relay verified | Inbound cancellation now propagates to the upstream request context and is covered by an observable unit test plus deterministic smoke. |
| privacy | verified at boundary | The client receives only the public alias and generic error. HYC tokens, OpenRouter identity, private slug and upstream response bodies are not persisted. |

The real-client probe is `scripts/probe-claude-code-hyc.ps1`. It creates a
short-lived `provider-spike` user and model-limited token, isolates user-level
Claude settings, enforces a `$0.08` run ceiling, and cleans up the user and
sessions. It is a live probe and must not be used as the default regression.

## Cursor

Cursor 3.13.25 is installed as an IDE launcher. This installation has no
separately installed `cursor-agent` headless executable. Cursor's documented
headless API-key option authenticates to Cursor; it is not an isolated custom
OpenAI Base URL switch. Changing the IDE-wide OpenAI Base URL would mutate the
user's daily model configuration, so it was not done.

| Scope | Result |
| --- | --- |
| Cursor application body | **unverified** |
| Safe isolated custom Base URL configuration | **unsupported in the available CLI** |
| OpenAI-compatible Chat buffered/SSE/tools/errors/cancellation | **verified at protocol and HYC relay layers** |
| Direct Cursor → OpenRouter | **not configured and forbidden** |

This distinction is intentional: protocol compatibility is not proof that the
Cursor UI itself completed a request.

## Default regression

`scripts/dev-smoke-test.ps1` now delegates to
`scripts/dev-relay-smoke-local.ps1`. The latter builds a loopback-only stub and
an isolated gateway, provisions a run-scoped SQLite database, and exercises
real HTTP and relay conversion without any Provider key or external route.
It covers Chat and Messages buffered/SSE, usage, tools, 401, 429 with
`Retry-After`, 5xx, timeout cancellation and interrupted-stream settlement.
Temporary database, binary and session state is removed after the run.

This local smoke is the repeatable regression. Live OpenRouter probes remain
explicit, budget-capped release diagnostics.
