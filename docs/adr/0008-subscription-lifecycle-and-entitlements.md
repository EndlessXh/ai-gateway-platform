# ADR 0008 — Subscription lifecycle, Wallet purchase and entitlements

Status: accepted for Phase 5C

## Context

Upstream rc.22 already owns `subscription_plans`, `user_subscriptions`,
`subscription_orders` and the independent subscription quota pool. Replacing
those tables would fork billing logic and make upstream synchronization unsafe.
They do not, however, provide a stable product key, bilingual product copy,
an explicit cancellation/renewal state machine, request idempotency or a
complete event trail.

## Decision

1. Upstream tables remain authoritative for plan price, duration, quota,
   orders and quota consumption. Additive `platform_*` companions own only
   product metadata, lifecycle snapshots, events and idempotency receipts.
2. A product plan moves `draft -> active -> archived`; archive is terminal.
   A subscription moves from `pending` to `active`, and then to `canceling`,
   `canceled`, `expired`, `renewal_failed` or `failed`. Clients never submit a
   lifecycle state.
3. Wallet purchase and renewal lock the user/request rows and atomically charge
   `users.quota`, create the upstream order/subscription, create the lifecycle
   snapshot, apply the independent quota pool and append events. One
   `(user, operation, idempotency key)` receipt identifies the result.
4. Subscription quota is an independent period pool. It is consumed before
   optional Wallet overflow. Group access is applied through the existing
   upstream subscription group fields and cache refresh; expiry restores the
   next active subscription source (or the upstream-defined prior/downgrade
   group when none remains) rather than overwriting unrelated administrator
   grants.
5. Automatic renewal means one idempotent Wallet-balance attempt at the period
   boundary. It reuses the existing subscription reset task and the explicit
   administrator reconcile endpoint; Phase 5C adds no new resident poller and
   claims no external-card authorization.

Package price is not model-call price. Package price has one authority,
`subscription_plans.price_amount`, and each purchase stores an immutable
decimal snapshot that is also the renewal price for that lifecycle. A due
renewal starts a fresh independent quota period; an early renewal of a finite
non-resetting plan adds one allotment without erasing unused quota. Model-call
prices continue to come from `ratio_setting` and
the existing Pricing API.

## Consequences

- Existing billing, channel routing and relay settlement remain intact.
- Cancellation at period end preserves paid-period entitlement; immediate
  termination is administrator-only, requires a reason and is audited.
- Financial subscriptions and orders are immutable; archive replaces delete.
- `PRICING_STATUS=provisional` prevents purchase, renewal and enabling those
  product switches. Seeded preview plans are internal, disabled and carry no
  asserted commercial price.
- Legacy external-payment subscriptions remain on the upstream endpoints until
  explicitly adopted into the product lifecycle; Phase 5C does not fabricate
  companion history for them.
- A plan with a product profile is excluded from every legacy purchase,
  payment-provider and admin-bind path; product mutations use only the
  lifecycle-aware API and its before/after audit trail.
