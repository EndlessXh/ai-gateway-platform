# Phase 5B handoff

> Historical entry handoff. Phase 5B is complete; use
> `docs/phase5b-wallet-profile.md` for results and `docs/handoff-phase5c.md` for
> the current continuation contract.

Written 2026-07-29 after Phase 5A. The final Phase 5A commit is the commit that
contains this handoff; resolve its immutable SHA with `git log -1 --format=%H`.
Starting commit was `28fd11fd0c8ade008276b981d39c08496833e2f8`.

## Stable contracts

- Public catalog: `GET /api/platform/models` and
  `GET /api/platform/models/:public_model_id`.
- Admin catalog CRUD/diagnostics: `/api/platform/admin/models...`, protected by
  existing `AdminAuth`.
- Pricing truth: existing `GET /api/pricing`; catalog metadata is enrichment,
  never a price source.
- Route truth: existing channels, abilities and model mappings; the catalog
  has no channel foreign key.
- Relay gate: a cataloged `api_enabled=false` alias is rejected before channel
  distribution.

Frontend entry points are `usePlatformModels()`,
`usePlaygroundPlatformModels()`, `platformModelQueryKeys`, `ModelIdentity`,
`ModelCatalogCard` and `CatalogAdmin` under
`web/src/features/model-catalog/`. Pricing already uses `ModelIdentity`.

## Phase 5B order

The single best sequence is: wallet balance/quota/top-up presentation first,
then profile/session/security presentation, then shared authenticated-console
regression coverage. This lets Profile reuse any identity/balance primitives
established by Wallet without touching catalog, Relay or billing rules.
After that, extend Models/Playground only through the existing catalog hooks;
do not begin subscriptions/payment work unless separately scoped.

Do not change quota arithmetic, settlement, ratio settings, channel routing,
provider adapters, catalog price boundaries, attribution constants, the lint
baseline, generated route output by hand, or `../new-api-infra`.

## Current blockers

1. `SOURCE_CODE_URL` is unset; AGPL §13 publication remains a human release
   task.
2. `PRICING_STATUS=provisional`; commercial prices are not approved.
3. nginx has not passed a real-environment `nginx -t`.

## Verification commands

```powershell
pwsh ./scripts/dev-health.ps1
pwsh ./scripts/lint-guard.ps1
cd web
bun run typecheck
bun run test
bun run test:e2e -- --project=chromium
bun run build
cd ..
go vet ./model ./service ./controller ./middleware ./router
go test ./model ./service ./controller ./middleware ./router
go build ./...
pwsh ./scripts/dev-smoke-test.ps1
```

For live browser tests set `HYC_LIVE_E2E=1` and load
`HYC_LIVE_PASSWORD` from the gitignored local credential file only into the
process environment. Keep using `newAppPage` and `withRootSession`; never
manually inject a Session/theme/locale or clear the Session table.
