# Phase 5C — Subscription plans, entitlements and lifecycle

## Scope and boundaries

Phase 5C extends, rather than replaces, the rc.22 subscription subsystem. The
upstream `subscription_plans`, `user_subscriptions`, `subscription_orders` and
`subscription_pre_consume_records` remain the billing and quota authority.
Four additive tables provide the missing product contract:

| Table | Responsibility |
| --- | --- |
| `platform_subscription_plan_profiles` | stable `plan_key`, bilingual copy, visibility, product lifecycle and purchase/renew switches |
| `platform_subscription_lifecycles` | state, cancellation and Wallet auto-renew flags, immutable name/price/currency/order snapshots |
| `platform_subscription_events` | append-only, uniquely keyed lifecycle and entitlement audit events |
| `platform_subscription_requests` | unique `(user_id, operation, idempotency_key)` request receipts |

The schema uses unique indexes on profile plan/key, lifecycle subscription and
request/event identities, lookup indexes for user, plan, state and time, and
database checks for plan visibility/state and subscription state. The upstream
schema deliberately carries no physical foreign keys; the companions follow
that compatibility rule and enforce plan/user/subscription references inside
locked service transactions. Financial hard delete is blocked. No card, bank
or provider secret is stored.

## State machine

Plans are `draft -> active -> archived`; archive disables the upstream plan,
purchase and renewal, and cannot be reversed. Product subscriptions cover
`pending`, `active`, `canceling`, `canceled`, `expired`, `renewal_failed` and
`failed`. The model service owns transitions. A user cancellation sets
`cancel_at_period_end`, leaves the upstream subscription active and preserves
entitlements. It may be revoked before the boundary. At the boundary,
reconciliation closes the subscription and removes entitlement. Immediate
termination is administrator-only and requires a recorded reason.

Events include `created`, `purchased`, `activated`, `renewed`,
`cancel_scheduled`, `cancellation_revoked`, `canceled`, `expired`,
`entitlement_applied`, `entitlement_removed`, `renewal_failed` and `failed`.

## Price and Wallet transaction

The package sale price has one mutable authority:
`subscription_plans.price_amount` and `.currency`. The browser never supplies
price or quota. Purchase stores the exact decimal price/currency and completed
upstream order ID in the lifecycle/financial records, so later edits do not
rewrite history. Model-call price remains separate in `ModelRatio`,
`CompletionRatio`, `ratio_setting`, `model.GetPricing()` and the Pricing API.

Purchase validates identity, compliance, published pricing, public active
plan, switches, balance and duplicate rules. Within one database transaction it
locks the user and idempotency identity, converts money through centralized
quota math, charges `users.quota`, creates a completed balance order and active
upstream subscription, creates the lifecycle/request records and appends the
purchase/activation/entitlement events. Any error rolls everything back.
Concurrent requests with the same key resolve to one receipt; reusing a key for
a different request is rejected. The browser keeps that key for the complete
logical attempt, including a retry after an ambiguous/business failure, and a
synchronous in-flight guard closes the render-before-disable double-click gap.

## Entitlements and quota semantics

Included quota is the existing independent per-subscription period pool:
`user_subscriptions.amount_total/amount_used`. It is not merged into Wallet
credit or lifetime usage. The upstream resolver consumes active subscription
quota first and uses Wallet only if that plan's `allow_wallet_overflow` permits
it. A renewal at or after the paid-period boundary starts a fresh pool from the
plan quota and clears period usage. An early manual renewal of a non-resetting
finite plan adds one purchased allotment without discarding unused quota;
periodically resetting plans keep their current pool until its boundary.

Access group and model access are the existing upstream `upgrade_group`,
`downgrade_group`, group-ratio and channel-model rules. When overlapping
subscriptions end, the current group falls back to the strongest remaining
active subscription; a group changed outside the ending subscription is
preserved. Phase 5C does not invent
feature, rate-limit or arbitrary JSON entitlements. Application/removal events
name the source, and upstream cache invalidation makes group changes visible to
new Token and Session requests. Expiry follows upstream group restoration so a
separate permanent administrator grant is not silently replaced.

## Renewal execution

Manual renewal is a Wallet transaction with its own idempotency key. Wallet
auto-renew is explicit opt-in, may be disabled at any time and makes only one
attempt per due boundary. Success charges once and extends the period; an
insufficient balance records `renewal_failed`/`failed`, disables auto-renew and
does not overdraw or retry indefinitely. Execution reuses the existing
subscription reset task and can also be invoked through administrator
`POST /api/platform/admin/subscriptions/reconcile`. There is no new daemon and
no claim of credit-card auto-charge.

## API contract

Public, localized and SQL-ID-free:

- `GET /api/platform/plans`
- `GET /api/platform/plans/:plan_key`

Authenticated user:

- `GET /api/platform/subscriptions/current`
- `GET /api/platform/subscriptions/history`
- `GET /api/platform/subscriptions/:id/events`
- `POST /api/platform/subscriptions/purchase`
- `POST /api/platform/subscriptions/:id/cancel`
- `POST /api/platform/subscriptions/:id/cancel/revoke`
- `PUT /api/platform/subscriptions/:id/auto-renew`
- `POST /api/platform/subscriptions/:id/renew`

Administrator:

- `GET|POST /api/platform/admin/subscriptions/plans`
- `GET|PUT|DELETE /api/platform/admin/subscriptions/plans/:id`
- `GET /api/platform/admin/subscriptions` with user/state/plan filters
- `GET /api/platform/admin/subscriptions/:id`
- `POST /api/platform/admin/subscriptions/:id/cancel`
- `POST /api/platform/admin/subscriptions/:id/renew`
- `POST /api/platform/admin/subscriptions/reconcile`

User ownership is always derived from authentication, never request JSON.
Administrator mutations use existing role middleware and management audit logs.
Names/descriptions reject markup; groups are allowlisted against `GroupRatio`;
duration, reset period, quota, purchase limit and price are validated.

## UI and operator workflow

`/my-subscription` uses the authenticated shell and real plan, Wallet and
lifecycle APIs. It shows current/history/empty states, immutable transaction
price, period and remaining days, independent quota progress, group/model
access summary, Wallet overflow/auto-renew, failures, actions and user events.
The existing administrator `/subscriptions` surface now leads with product
profiles and lifecycle diagnostics. Product price, quota and group edits go
through the product endpoint and record before/after audit values. Product
plans are excluded from legacy list, purchase, external-payment and admin-bind
paths so those routes cannot bypass the lifecycle transaction.

`scripts/dev-seed-subscription-plan.ps1` is development-only and create-only.
It can create `developer-preview` as internal/draft with purchase and renewal
disabled and price zero; repeated runs preserve operator edits and never
subscribe a user.

## Verification performed

- Empty SQLite migration repeated successfully; unique constraints and
  create-only seed behavior covered by model tests.
- Current PostgreSQL dev database migrated from 35 to 39 tables; users, Tokens
  and channels remained unchanged. Repeated startup is part of the final gate.
- Wallet purchase, rollback, immutable snapshot, same-key and concurrent
  idempotency, cancellation/revoke, immediate administrator termination,
  renewal, expiry and renewal-failure behavior are covered by Go tests.
- Final backup produced a 156.1 KB custom archive with 414 verified TOC entries;
  scratch restore returned 39 tables and 2 users, then the temporary dump was
  removed.
- Phase 5C browser tests cover user actions, duplicate click protection,
  business-failure envelope handling with same-key retry,
  administrator draft/events, three viewports, light/dark and en/zhCN. Evidence
  is in `artifacts/phase5c/`.
- Related Go tests, vet and `go build ./...` passed. Frontend typecheck, 116 unit
  tests and production build passed. The lint ratchet remains exactly 447.
- Phase 5C Playwright: mock 4 passed/1 live-only skipped; live 5/5 passed.
  Complete Playwright live passed 137/137 with four workers and a 60-second
  per-test timeout. Complete mock runs exposed only resource-sensitive
  30-second timeouts (120 passed/12 skipped/5 timed out, then 123/12/2); every
  timed-out case passed its immediate single-worker rerun (5/5 and 2/2).
- The live smoke passed login, Token creation, non-stream and SSE relay, two
  consumption logs, Token/Wallet quota synchronization and 403 no-charge.
  The first attempt was correctly blocked by the host C: drive's 95% monitor;
  rerunning the dev backend with its temporary cache directory on D: passed
  without weakening the threshold or changing repository configuration.

The Phase 5C delivery report records the same final command results.

## Known limits and launch blockers

- `PRICING_STATUS` remains `provisional`; the APIs and UI block purchasing and
  renewal, and admin cannot enable those switches.
- `SOURCE_CODE_URL` is not configured and real-environment `nginx -t` remains
  unverified. These are not marked complete.
- Legacy external-payment subscriptions do not receive retroactive product
  lifecycle companions. No new payment gateway, refund, proration, invoice,
  coupon or card authorization was added.
- The upstream quota type remains intentionally unchanged. Phase 5C does not
  widen quota columns or rewrite relay billing.
