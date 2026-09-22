# Handoff to Phase 6B

Phase 6A and its 6A.1/6A.2 technical-closure passes are complete at the OpenRouter
integration boundary. **Phase 6B has not started.** This document records
prerequisites; it does not authorize work.

## Validated foundation

- OpenRouter is the only selected upstream direction.
- `claude-opus-4.6` maps privately to the live-verified
  `anthropic/claude-opus-4.6` route in the isolated `provider-spike` group.
- Chat and Anthropic Messages are core supported surfaces.
- Responses buffered/SSE works, but remains Beta and non-core.
- privacy routing is server-owned on all three protocol surfaces;
- model/header/error/log/generation-ID disclosure controls are implemented and
  covered by unit plus live tests;
- pre-consume/refund/settle remains the existing billing implementation, with
  idempotency and failure-no-charge coverage;
- pricing remains provisional and no production channel exists;
- the default relay smoke is now loopback-only, deterministic and zero-cost;
- Claude Code 2.1.220 completed the minimal real HYC → OpenRouter path after
  the format-scoped metadata validation fix;
- Cursor application-body verification remains unavailable; only the required
  OpenAI-compatible protocol is verified.

## Open launch blockers

1. Approve commercial price and change `PRICING_STATUS` through the existing
   release process; Phase 6A development ratios are not a price decision.
2. Publish the exact corresponding modified source and configure the real
   HTTPS `SOURCE_CODE_URL`; the release gate remains fail-closed while empty.
3. Establish a supported isolated Cursor agent invocation or complete
   a supervised client test without exposing the HYC token.
4. Decide whether the deployment egress needs an explicit OpenRouter proxy or
   a region-compatible direct route. The local system-proxy setting is only a
   development fact.
5. Run `scripts/preflight-openrouter-egress.ps1` in the production runtime,
   re-run nginx verification, and clear the existing source/compliance gates.

## Explicit non-goals

Do not infer approval for multi-provider failover, a second OpenRouter adapter,
provider ordering, session-ID routing, full OpenRouter model import, UI work,
production channel creation, long-context benchmarks, load tests, or real 429
generation. Those require a separately scoped Phase 6B decision.
