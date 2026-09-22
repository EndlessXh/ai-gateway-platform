# Phase 5C handoff

> Historical entry contract. Phase 5C is complete; use
> `docs/phase5c-subscriptions.md` for the implementation and verification
> record, ADR 0008 for the decisions, and `docs/handoff-phase5d.md` for the
> next-stage contract.

Phase 5C started at `d92b586a43852a04fd208c408b679f0377eefefd`.
The final revision is the commit containing this handoff; resolve it with
`git log -1 --format=%H` after checkout.

## Stable contracts inherited from Phase 5B

- Wallet remains `users.quota`, `users.used_quota`, `users.request_count`,
  `logs` and `top_ups`; `/wallet` does not maintain a second balance.
- Profile, OAuth, Passkey and Session APIs are unchanged. Token and Session
  access continue to resolve current user/group state.
- Model-call price remains in `ratio_setting` and the Pricing API. Package
  price is separate and authoritative in the upstream subscription plan.
- Session-aware E2E continues to use `newAppPage`, `withRootSession` and the
  cleanup helpers from `web/e2e/helpers/app-state.ts`.

## Phase 5C additions

- Four additive `platform_subscription_*` companion tables preserve the
  upstream subscription/order/quota authorities.
- Public product plans, authenticated subscription lifecycle APIs and
  administrator plan/diagnostic APIs live under `/api/platform`.
- `/my-subscription` provides the real user lifecycle surface; the existing
  `/subscriptions` administrator page now includes product metadata and event
  diagnostics.
- Wallet purchase/renewal are transactional and idempotent. Default cancel is
  at period end; forced termination is administrator-only and audited.
- Automatic renewal means one Wallet-balance attempt through the existing
  reset task or explicit reconcile endpoint—never an external-card claim.

## Boundaries and gates

Do not rewrite relay billing, quota arithmetic, group resolution, channel
routing, provider adapters, Session controls, attribution, or
`../new-api-infra`. Do not physically delete a financial subscription or make
an archived plan active again.

`SOURCE_CODE_URL` remains unset, `PRICING_STATUS` remains `provisional`, and a
real-environment `nginx -t` has not passed. Purchasing and renewal therefore
remain release-gated; preview seed data is internal, disabled and not a claim
of commercial pricing.
