# Phase 5A — Product model catalog and metadata foundation

Completed and verified on 2026-07-29 from starting commit
`28fd11fd0c8ade008276b981d39c08496833e2f8`. This phase establishes product
model metadata only; wallet, profile, subscriptions, payments and a full
Playground redesign remain out of scope.

## Data model

`platform_model_catalog` is additive and uses GORM's existing migration path.
It contains `id`, unique `public_model_id`, display/provider fields, English and
Simplified Chinese descriptions, category, JSON-array capabilities and
modalities, optional context label, allowlisted icon/badge keys, one explicit
availability status, independent visibility/surface/API switches, recommended
state, sort order, timestamps and soft deletion.

Allowed availability values are `available`, `preview`, `maintenance`,
`coming_soon` and `disabled`; visibility is `public` or `hidden`. Input is
trimmed and allowlisted. Public IDs are lowercase stable aliases, display text
rejects markup delimiters, arrays reject unknown and duplicate values, and
icon keys cannot be URLs. See ADR 0007.

## API and permissions

Public, optionally authenticated for group-aware route diagnostics:

- `GET /api/platform/models?locale=en|zhCN&surface=pricing|playground`
- `GET /api/platform/models/:public_model_id?locale=en|zhCN`

Responses contain only product metadata, locale-selected description, current
pricing and safe route availability. They never include channel IDs, provider
URLs, keys, selected credentials or provider error bodies.

Existing admin authentication protects:

- `GET /api/platform/admin/models`
- `GET /api/platform/admin/models/diagnostics`
- `GET /api/platform/admin/models/:id`
- `POST /api/platform/admin/models`
- `PUT /api/platform/admin/models/:id`
- `PATCH /api/platform/admin/models/:id/api-enabled`
- `DELETE /api/platform/admin/models/:id` (soft archive)

Anonymous admin access returns 401 and a common user returns 403. Controller
errors are stable and do not expose SQL. The Relay distributor returns 403 for
a cataloged model whose API switch is off; uncataloged upstream models remain
compatible.

## Pricing and channel boundary

The catalog stores no prices. `ModelRatio`, `CompletionRatio`, fixed-price and
other `ratio_setting` data remain the only pricing truth used by billing and
`GET /api/pricing`. The service joins catalog metadata onto those calculated
responses; missing configuration is reported as `pricing_unavailable`.

The catalog also stores no channel binding. Existing channels, abilities,
priority, weight, mapping and failover remain authoritative. The service only
checks whether the public alias has an enabled route and whether the request
group can use one. It never creates a synthetic channel.

## Cache and consistency

- Key: `platform:model_catalog:v1:active-list`
- TTL: 30 seconds
- Store: existing hybrid Redis/process-memory cache
- Invalidation: successful create, update, API toggle and archive
- Failure behavior: log Redis failure, read the database, use only bounded
  local hot-cache behavior
- Multi-instance behavior: every writer deletes the shared Redis key; the
  30-second local TTL bounds a process that cannot reach Redis
- Pricing: aggregated after catalog retrieval and therefore never frozen in
  the catalog cache

## Seed and administration

`pwsh ./scripts/dev-seed-model-catalog.ps1` authenticates to the local dev API
using the existing gitignored credential file in memory. It adds only
`platform-general-preview` and `platform-reasoning-preview`, with bilingual
copy and verified capabilities/modalities. Both are preview platform aliases.
The script writes no channel, key or price, runs only when invoked, uses
create-if-absent behavior and preserves later administrator edits.

The existing `/models/catalog` console tab provides search/status filtering,
create/edit, surface switches, recommendation and ordering controls, API
enablement, archive, route counts and pricing diagnostics. Saves invalidate
catalog and pricing queries without a service restart.

## Frontend integration and i18n

`/model-catalog` reads the public API and supports search, category,
capability and status filters plus loading/error/empty states. Shared
`ModelIdentity` presentation is also used by Pricing, so display name,
provider, full tooltip ID and accessible full-value copy stay aligned.
Pricing continues to render its existing API values. The Playground only gains
`usePlaygroundPlatformModels()`: it intersects user-accessible route models
with catalog metadata and disables maintenance, coming-soon, disabled or
inaccessible entries; its interaction UI was not redesigned.

Fixed UI text remains in the single existing i18next `translation` namespace.
English and zhCN are complete; database model descriptions are operational
content rather than static locale keys. The sync report has zero missing keys
for every shipped locale.

## Verification results

- Go related tests passed for model, service, controller, middleware and
  router; they cover migration/index/unique/validation/CRUD/locale/pricing/
  route/cache/seed/permissions and the disabled Relay gate.
- `go vet` related packages and `go build ./...`: passed.
- Frontend: typecheck passed; Bun unit tests 114/114; build passed.
- Lint guard: 447 inherited violations, exactly the existing baseline; no new
  debt. Modified files pass formatting and `git diff --check`.
- Playwright mock: 105 passed, 10 live-only skipped. Playwright live: 115/115.
- Catalog browser matrix: 390×844, 768×1024 and 1440×900; light/dark; en/zhCN;
  2/20/100 cards; search/filter/empty/error; Pricing alignment; full ID/copy;
  overflow. Live checks additionally cover the real public catalog, real
  Playground metadata, admin create/edit/disable/no-route/no-price/
  maintenance/archive and Session-safe cleanup.
- Development health: PostgreSQL and Redis healthy, API 200, 35 tables.
- Seed: two consecutive runs preserved the same two active entries.
- Backup: `pg_dump -Fc` produced 371 verified TOC entries; scratch restore
  succeeded with 35 tables and 2 users; the temporary dump was deleted.
- Existing rc.22 development database migrated 34→35 tables on startup. A
  separate rc.16 cutover source copy migrated 31→35 tables while preserving
  8 users, 14 tokens, 2 channels, 37 logs and total quota 124980344 exactly;
  post-migration Relay/log/billing passed and scratch state was removed.
- Live smoke: login, bounded model-scoped Token, non-streaming response, SSE
  (6 chunks and `[DONE]`), two consumption logs and quota decrement
  500000→499986 passed.

Evidence is under `artifacts/phase5a/`.

## Rollback and known limits

Application rollback is safe because the schema change is additive. First
disable or archive affected entries, deploy the prior binary and retain the
table for audit/history. Only after a verified backup and dependency check may
an operator explicitly drop `platform_model_catalog`; production never needs a
database reset. The migration is forward-only and no automatic destructive
down migration is supplied.

Known limits: public list route checks are currently per catalog row after a
cached metadata read, acceptable for this foundation but a candidate for bulk
aggregation if the live catalog grows materially; descriptions support en and
zhCN with English fallback; catalog status is not an upstream health monitor;
pricing remains provisional. The three existing launch blockers remain:
`SOURCE_CODE_URL` unset, pricing not commercially approved, and no real
environment `nginx -t` result.
