# Phase 5D handoff

Phase 5C starts at `d92b586a43852a04fd208c408b679f0377eefefd`.
The final revision is the commit containing this document; resolve its immutable
SHA with `git log -1 --format=%H` after checkout. The required subject is
`feat(subscriptions): establish plans entitlements and lifecycle`.

## Delivered contract

- Public plan API: `GET /api/platform/plans` and
  `GET /api/platform/plans/:plan_key`.
- Authenticated lifecycle API: current, history, owned events, Wallet purchase,
  period-end cancel/revoke, Wallet auto-renew and manual renewal under
  `/api/platform/subscriptions`.
- Administrator API: product plan CRUD/archive, filtered lifecycle list,
  detail/events/entitlement diagnostics, cancellation, immediate termination,
  renewal and reconcile under `/api/platform/admin/subscriptions`.
- Frontend hooks are in `web/src/features/subscriptions/api.ts`; product types
  are in `types.ts`. `UserSubscriptions` powers `/my-subscription`, and
  `PlatformPlanManagement` augments the existing administrator subscriptions
  page.
- Lifecycle and entitlement service code is centralized in
  `model/platform_subscription.go`. The recurring entry is
  `service/subscription_reset_task.go`; the explicit recovery entry is the
  administrator reconcile API.

## Safe extension points

Add presentation metadata to `platform_subscription_plan_profiles`, new
append-only event types to `platform_subscription_events`, and additional
derived entitlement summaries in the lifecycle service. New schedulers may call
the existing idempotent renewal/reconcile functions. Adopt a legacy subscription
only through an explicit, tested migration that creates a truthful price/order
snapshot.

Do not duplicate or bypass `subscription_plans`, `user_subscriptions`,
`subscription_orders`, centralized quota conversion, upstream quota selection,
group/cache refresh, Token/Session authorization, Pricing API, relay settlement
or channel routing. Do not physically delete financial subscriptions.

## Open gates and next recommendation

Launch remains blocked by missing `SOURCE_CODE_URL`,
`PRICING_STATUS=provisional`, and lack of a real-environment `nginx -t` result.
Do not enable purchase or describe preview data as commercial pricing.

The single best Phase 5D sequence is: obtain approved commercial plan prices
and source-offer URL, validate production nginx/TLS, publish the price state,
then run one controlled Wallet purchase/renewal/cancel lifecycle against a
non-production account before considering any external payment integration.

## Verification commands

Final Phase 5C snapshot: related Go tests/vet/build passed; frontend typecheck,
116 unit tests and production build passed; lint remained at 447. Phase 5C
Playwright passed 4/4 mock plus 5/5 live, and complete live passed 137/137.
Complete mock runs had only 30-second resource timeouts, all of which passed
single-worker reruns. Live non-stream/SSE/Wallet/log/403 smoke, dev health,
seed idempotency, Compose config and scratch backup restore passed.

```powershell
pwsh ./scripts/lint-guard.ps1
go test ./model ./controller ./router ./service
go vet ./model ./controller ./router ./service
go build ./...
Set-Location web
bun run format:check
bun run typecheck
bun run test
bun run build
bun run test:e2e
Set-Location ..
docker compose --env-file deploy/.env.dev -f deploy/compose.dev.yaml config --quiet
pwsh ./scripts/dev-health.ps1
```

Live E2E credentials must be supplied through the existing gitignored local
credential fixture; never add them to this document or the repository.
