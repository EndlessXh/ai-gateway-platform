# OpenRouter release readiness

**Assessment date:** 2026-07-31
**Decision:** **not ready for production sale**

The OpenRouter protocol and HYC development route are validated, and the
default regression no longer spends Provider money. Production release is
still blocked by source publication, commercial pricing approval, and a real
deployment/nginx verification.

## Evidence boundary

| Surface | Status |
| --- | --- |
| Direct OpenRouter Chat/Messages/Responses live | verified in Phase 6A |
| HYC AI live relay | verified in Phase 6A |
| Claude Code native Messages/SSE | minimal native HYC → OpenRouter route verified in Phase 6A.2 |
| Cursor application | unverified |
| OpenAI-compatible protocol required by Cursor | verified |
| Local deterministic relay regression | verified, zero Provider cost |
| Production deployment | unverified |
| Commercial price | provisional |

## Cost reconciliation

The key-free OpenRouter Models API was read on the assessment date. Values are
USD per token; the per-million column is included only for readability.

| Usage class | OpenRouter field | USD/token | USD/1M | Current HYC development ratio | Reconciliation |
| --- | --- | ---: | ---: | ---: | --- |
| input | `prompt` | 0.000005 | 5.00 | ModelRatio 2.5 | exact at the existing $0.002/1K base |
| output | `completion` | 0.000025 | 25.00 | CompletionRatio 5.0 | exact relative to input |
| cache read | `input_cache_read` | 0.0000005 | 0.50 | CacheRatio 0.1 | exact relative to input |
| 5-minute cache write | `input_cache_write` | 0.00000625 | 6.25 | CreateCacheRatio 1.25 | exact relative to input |
| internal reasoning | `internal_reasoning` | not separately listed | — | no separate ratio | reported reasoning tokens are part of output usage; no independent price is asserted |

The development group multiplier is 1.0. Thus the configured ratios reproduce
the current upstream token prices before rounding and quota conversion. This
is a technical parity check, not an approved retail price or margin decision.
No new ratio was applied.

Phase 6A live evidence observed 4,502 cache-write tokens followed by 4,502
cache-read tokens, reasoning usage, actual settlement, failure-no-charge, and
client-aborted SSE settlement. Unit tests cover retry classification and
idempotent refund/settlement. Phase 6A.1's deterministic smoke additionally
showed successful-request quota 66, zero billing for 401/429/5xx/timeout, and
partial interrupted-stream settlement of 12 quota units.

Phase 6A.1 OpenRouter account usage began and ended at `$0.1542845`:
**new spend `$0.0000000`**, below the `$0.10` ceiling. The unsuccessful Claude
Code live attempt was not billed.

Phase 6A.2 located that failure before upstream I/O, fixed the format-scoped
`metadata` validation, and completed the minimal native live request. The
Phase 6A.2 before/after account measurement also reported **new spend
`$0.0000000`**, below its `$0.08` hard ceiling.

## Release blockers

1. `SOURCE_CODE_URL` is empty. The exact deployed modified source must be
   published at a real public location selected by the owner.
2. `PRICING_STATUS=provisional`. A human commercial decision must approve
   price, tax/margin assumptions and the existing release process.
3. Production Compose/nginx has not been proven in the target environment;
   `nginx -t`, DNS, TLS, proxy and long-lived SSE must pass there.
4. Cursor application-body verification remains unavailable. Claude Code is
   verified only for the bounded native path documented in Phase 6A.2, not for
   long autonomous agent workloads.

`scripts/preflight-release.ps1 -Environment prod` remains the authoritative
fail-closed release gate. Do not supply a placeholder source URL or mark
pricing approved merely to make it pass.

## Operator checklist

1. Run `scripts/preflight-openrouter-egress.ps1` on the host and inside the API
   container/network namespace.
2. Configure either verified direct egress or one explicit, monitored channel
   proxy. A configured proxy failure must fail closed; do not silently route
   around organizational policy.
3. Run the zero-cost local smoke and normal health/regression suite.
4. Run only the minimum budget-capped live probe required for the release.
5. Publish the corresponding source, set the real HTTPS `SOURCE_CODE_URL`, and
   obtain pricing approval.
6. Run `verify-nginx.ps1` and the strict production release preflight.
