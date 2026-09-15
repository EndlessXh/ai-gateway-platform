# ADR 0006 — Pricing has exactly one source of truth

- Status: Accepted
- Date: 2026-07-28

## Context

ADR 0005 left an open question: should the public pricing page render from the
billing ratios, or from a separate presentation catalogue?

The risk in a gateway product is a **second set of price numbers**. Once a
marketing table and a billing table both exist, they drift, and the first
symptom is a customer charged something other than the advertised price.

Investigating the existing code answered the question rather than requiring a
new design. `GET /api/pricing` (`controller/pricing.go` → `model.GetPricing()`)
already derives from the same `setting/ratio_setting` maps that the billing
path consumes. Verified live against the running dev stack:

```
GET /api/pricing
  platform-general-preview    model_ratio=0.2  completion_ratio=2.5
  platform-reasoning-preview  model_ratio=0.3  completion_ratio=3
```

Those are exactly the values `scripts/dev-seed-channel.ps1` wrote into
`ModelRatio` / `CompletionRatio`, and exactly the values that produced
`used_quota=106` in the smoke test. One number, one path.

## Decision

**The backend `ratio_setting` maps are the only source of pricing truth.**

1. Prices are stored once, in the upstream ratio/pricing settings
   (`ModelRatio`, `CompletionRatio`, `ModelPrice`, cache/group ratios), managed
   through *System Settings → Group & Model Pricing*.
2. The public pricing page consumes `GET /api/pricing`. It does not embed,
   hardcode, or recompute prices.
3. The frontend may own **presentation metadata only** — display name,
   description, capability tags, context window, ordering, badges. Anything
   that is a number a customer is charged by must come from the API.
4. If `platform_model_catalog` is introduced later, it stores presentation
   metadata **keyed by model name** and must not contain a price column.
5. `PRICING_STATUS` gates release: while it is `provisional`,
   `scripts/preflight-release.ps1` fails a production preflight. Development is
   unaffected.

## Consequences

**Good.** The advertised price cannot diverge from the charged price, because
there is only one number. Changing a price is one edit in admin settings and
the public page follows automatically. No reconciliation job is needed.

**Cost.** The pricing page is constrained by what `GET /api/pricing` returns.
Richer presentation needs either presentation-only metadata alongside it or an
upstream change to the endpoint — not a second price store. Group ratios mean
the displayed price is user-dependent, so the page must handle the anonymous
case (default group) distinctly from a signed-in user's group.

**For Phase 4** — reuse, do not rebuild:

| Concern | Existing code |
|---|---|
| Data fetching | `web/src/features/pricing/hooks/use-pricing-data.ts` |
| API client | `web/src/features/pricing/api.ts` |
| Types | `web/src/features/pricing/types.ts` |
| Price computation | `web/src/features/pricing/lib/price.ts` |
| Model helpers | `web/src/features/pricing/lib/model-helpers.ts` |
| Filtering | `web/src/features/pricing/lib/filters.ts`, `hooks/use-filters.ts` |
| Dynamic/expression pricing | `web/src/features/pricing/lib/billing-expr.ts`, `components/dynamic-pricing-breakdown.tsx` |

Phase 4 restyles `components/pricing-table.tsx`, `pricing-columns.tsx`,
`pricing-toolbar.tsx` and `model-details.tsx`. It must not introduce a new
price constant, a new pricing fetch, or a local price calculation.

**Rejected — a separate marketing catalogue with its own prices.** Nicer
copywriting is not worth a class of bug where the site advertises one price and
the invoice says another.
