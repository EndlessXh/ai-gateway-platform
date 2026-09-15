# ADR 0009 — OpenRouter as a private upstream route

**Status:** Superseded by ADR 0010 for public-catalog models — see `docs/adr/0010-openrouter-catalog-model-transparency.md`. This route (`claude-opus-4.6` / `provider-spike`) is unaffected and keeps the configuration below unchanged.
**Date:** 2026-07-31

## Context

The Mantle and Azure directions were ended. The product needs one validated
Claude Opus 4.6 route without exposing the upstream aggregator, concrete model
slug, route IDs, headers, URLs or diagnostics to users.

## Decision

Use the existing OpenRouter channel type and OpenAI-compatible adapter with
base URL `https://openrouter.ai/api`. Advertise only `claude-opus-4.6` and keep
its concrete mapping in the channel. Reuse the established inbound Anthropic
Messages conversion because live tests prove preservation of system, streams,
tools, tool results, cache accounting, reasoning, usage and stop reason.

On Chat, Messages and Responses, overwrite provider routing with data
collection denied, ZDR required and parameter support required. Do not set an
ordered provider list. Reject user routing, metadata and session controls.

At the public boundary, rewrite models and request-like response IDs, strip
upstream headers and typed-response extensions, classify errors generically,
and remove routing IDs from user logs. Preserve full credentials nowhere in
source, output, snapshots or logs.

Responses remains a non-core Beta surface. A Responses incompatibility alone
does not invalidate Chat or Messages availability.

## Consequences

- Provider selection can change behind a stable product alias.
- OpenRouter's availability and cache-aware routing remain intact.
- A deployment may need an explicit region-compatible egress proxy.
- Administrator diagnostics remain available, while user-visible protocol and
  log surfaces contain only platform identities.
- Commercial price approval remains independent and provisional.
