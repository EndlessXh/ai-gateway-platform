# ADR 0005 — Provisional development pricing

- Status: Accepted (development only)
- Date: 2026-07-28

## Context

New API rejects any request for a model with no configured price:

```
model_price_error: Model platform-general-preview price not configured.
```

The neutral aliases from ADR 0003 are new model names as far as billing is
concerned and inherit nothing from the upstream model they map to. Without
pricing, the relay chain cannot be exercised at all.

Upstream offers "self-use mode", which bypasses billing entirely. Using it
would have made the smoke test pass while proving nothing about the billing
path — precisely the kind of green-but-meaningless result to avoid.

## Decision

Configure **explicit provisional pricing** for the aliases and keep billing on.

Convention: `ModelRatio` 1.0 == $0.002 per 1K prompt tokens.
`CompletionRatio` multiplies the prompt ratio for output tokens.

| Alias | ModelRatio | CompletionRatio |
|---|---|---|
| `platform-general-preview` | 0.2 | 2.5 |
| `platform-reasoning-preview` | 0.3 | 3.0 |

Applied by `scripts/dev-seed-channel.ps1`, which **merges** into the existing
ratio maps rather than replacing them — upstream ships defaults for hundreds of
models (239 entries after merge) and overwriting would break every other model.

These values are chosen to be plausible for the current upstream models so the
billing arithmetic exercises realistically. They are **not** a commercial price
list, and are labelled as such in the script output and in this ADR.

## Consequences

**Good.** The full billing path is genuinely verified: a live request produced
`used_quota=106` against a token that started at 500,000, with matching
consumption log entries. Self-use mode would have shown `used_quota=0`.

**Cost.** These numbers must not leak into production. Real pricing is a
commercial decision requiring actual upstream cost data, margin targets, and a
per-region view — none of which this session can determine.

**Open, blocking a public launch:**

- Real per-model pricing set deliberately by the business.
- Reconciliation against real upstream costs — the intended purpose of the
  planned `platform_provider_costs` table.
- Decision on whether the public pricing page renders from `ModelRatio` or from
  a separate presentation catalogue (`platform_model_catalog`). Deriving
  displayed prices directly from billing ratios keeps them honest and
  automatically consistent; a separate catalogue allows nicer presentation but
  can drift from what is actually charged.

**Rejected — enable self-use mode.** Produces a passing test that proves the
billing path was never executed.
