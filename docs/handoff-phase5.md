# Phase 5 handoff

Written 2026-07-29 at the end of Phase 4.5 (independent acceptance). Everything
here was verified against a running system. The Phase 4.5 audit is in
`docs/phase4-5-acceptance.md`.

## 1. Repository

| | |
|---|---|
| Branch | `product/main` |
| Commit | see `git log -1` — the Phase 4.5 acceptance commit |
| Upstream baseline | New API **v1.0.0-rc.22** |
| Upstream commit | `bc14c18f6024e79cba1c08d02cd007796e12d668` |
| Working tree | clean at handoff |

Modified upstream files (keep this list short — `docs/upstream-sync.md`):
`model/log.go`, `model/log_format_test.go`, `main.go` (`BIND_ADDRESS`),
`controller/misc.go`, plus product-owned `README.md`, `CLAUDE.md`, `.gitignore`.

## 2. Start the stack

```powershell
pwsh ./scripts/dev-up.ps1          # PostgreSQL 16 + Redis 7
pwsh ./scripts/dev-backend.ps1     # API   -> 127.0.0.1:3001 (loopback only)
cd web; bun run dev                # Front -> 127.0.0.1:4173 (loopback only)
```

Verify: `pwsh ./scripts/dev-health.ps1`

## 3. Ports — do not confuse these

| Port | Owner | Notes |
|---|---|---|
| **4173** | product frontend | the only URL to browse for this product |
| **3001** | product API | |
| **3000** | `new-api-infra` rc.16 baseline | **protected, read-only, never modify** |
| 5433 / 6380 | product PostgreSQL / Redis | loopback only |
| 3150 | cutover-rehearsal instance | transient; see P1-3 in the acceptance doc |

`4173` is canonical and fails rather than drifting to another port.

## 4. Brand chain

Precedence, highest first:

1. Administrator override (System Settings → site name), unless it is the
   upstream default
2. `PLATFORM_BRAND_NAME` environment variable
3. `web/src/config/brand.ts` → `brandConfig.name`
4. Safe fallback `HYC AI`

Backend: `setting/platform/brand.go` → `ResolveProductName`.
Frontend: `web/src/config/brand.ts` → `resolveProductName` / `resolveProductLogo`.

`New API` is explicitly rejected as an ordinary product name at both layers, so
the UI cannot silently revert to the upstream brand.

**Attribution is not brand config.** `UpstreamProjectName`,
`UpstreamProjectUrl`, `AttributionNotice` and `LicenseName` are **constants** in
`setting/platform/compliance.go` with no environment override, guarded by
`TestAttributionIsNotConfigurable` and by `scripts/preflight-release.ps1`.
Do not make them configurable.

**HYC AI is still a working name.** Everything resolves from the config module;
if renaming requires touching anything else, that is a bug.

## 5. Pricing chain — one source of truth

```
ratio_setting (ModelRatio / CompletionRatio, admin settings)
  -> model.GetPricing()
  -> GET /api/pricing
  -> web/src/features/pricing/hooks/use-pricing-data.ts
  -> pricing UI
```

Reuse, do not rebuild: `api.ts`, `types.ts`, `lib/price.ts`,
`lib/model-helpers.ts`, `lib/filters.ts`, `hooks/use-filters.ts`,
`lib/billing-expr.ts`.

**Never introduce a second price number.** The frontend may own presentation
metadata (description, capability, context window, ordering) but no value a
customer is charged by. See ADR 0006.

`PRICING_STATUS=provisional` gates release; the pricing page shows a
provisional banner while it is set.

## 6. Routes

Authoritative list: `docs/page-matrix.md` (derived from `web/src/routes/`).
`web/src/routeTree.gen.ts` is generated — never hand-edit.

## 7. Completed in Phase 4 / 4.5

| Surface | State |
|---|---|
| Public shell, header, mobile nav, footer | Complete; footer carries full legal surface |
| Landing `/` | Complete — narrative, API example, verified capabilities, request path, CTA |
| Pricing `/pricing` | Complete; live API, provisional banner, full model names |
| `/sign-in`, `/sign-up`, `/login`, `/register` | Complete, including legacy redirects |
| Error surfaces (401/403/404/500/503) | Complete, shared recovery layout |
| Authenticated shell, `/dashboard/overview`, `/keys`, `/usage-logs/common` | Complete shell pass |
| Light + dark | Complete; dark is a designed palette, not an inversion |
| en + zhCN | Complete; no raw keys, no overflow |
| Admin and remaining P2/P3 interiors | Inherited upstream design — **Phase 5 work** |

## 8. Safe to modify in Phase 5

- `web/src/features/**` page interiors (admin, wallet, profile, models,
  playground, subscriptions)
- `web/src/components/ui/**` — check every consumer first
- `web/src/styles/*.css` — tokens; changes are global by design
- `web/src/i18n/locales/*.json`
- `docs/**`, `artifacts/**`

## 9. Do not modify

- `relay/**`, `service/**`, `model/**` — relay and billing core; the billing
  invariants in `AGENTS.md` are not negotiable
- `common/quota_math.go` — quota saturation guards
- `web/src/routeTree.gen.ts` — generated
- `LICENSE`, `NOTICE`, `THIRD-PARTY-LICENSES.md`, `AGENTS.md`
- `setting/platform/compliance.go` attribution constants
- `web/.oxlint-baseline.json` — only via `scripts/lint-guard.ps1 -Update`
- `../new-api-infra` — protected baseline

## 10. Launch blockers

Run `pwsh ./scripts/preflight-release.ps1` for the live list.

| Blocker | Status |
|---|---|
| **AGPL §13** — source not published, `SOURCE_CODE_URL` unset | Open. Enforcement is in place (prod compose refuses to start; preflight fails); publishing is a human task. |
| **Pricing** — `PRICING_STATUS=provisional` | Open. Placeholder ratios (ADR 0005) need real commercial pricing. |
| **nginx** — config never syntax-checked | Open. `scripts/verify-nginx.ps1` cannot run here (no container registry route). CI `deploy-config` job runs `nginx -t`. |

Note: with the P1-1 fix the footer no longer advertises the missing source URL
to visitors. That is a presentation change only — the release gate is unchanged
and still blocks production.

## 11. Suggested Phase 5 order

Console interiors before admin: they are user-facing and share components that
admin then inherits.

| # | Work | Verify |
|---|---|---|
| 1 | Model metadata (descriptions, context window, capability) — closes P2-1 | `/pricing` shows no "No description available." |
| 2 | `/wallet` and `/profile` interiors | `bun run typecheck`; overflow at 390/1440 |
| 3 | `/models`, `/playground`, `/subscriptions` | as above |
| 4 | Admin interiors — density and diagnosis over polish | as above |
| 5 | Status page or explicit Uptime Kuma link-out | route renders or nav link resolves |
| 6 | API quickstart route | direct URL + reload |

After each step:

```powershell
cd web; bun run typecheck
pwsh ./scripts/lint-guard.ps1
```

Before committing:

```powershell
cd web; bun run test
cd web; bunx playwright test e2e/phase4-5-acceptance.e2e.ts
pwsh ./scripts/dev-smoke-test.ps1
```

## 12. Testing notes that will save you time

- The acceptance suite resets the **development** rate-limit counters in
  `beforeAll`. Do not "fix" a 429 by lowering the limits — they are a
  production security control.
- Theme is a **cookie** (`vite-ui-theme`); language is localStorage
  `i18nextLng` with codes `en` / `zhCN` / `zhTW`. Setting the wrong storage or
  code silently no-ops and produces a mislabelled pass.
- Asserting HTTP 200 proves nothing in an SPA — a missing route still returns
  200 and renders "not found". Assert rendered DOM.
- `web/dist` is embedded via `//go:embed`, so `bun run build` must succeed
  before `go build`.

## 13. Secrets

All real credentials live in environment variables or uncommitted config:
`deploy/.env.dev` (gitignored, from `scripts/new-secrets.ps1`),
`.platform-tmp/` (gitignored), and upstream provider keys in the database.
No secret value appears in any document, script or commit.

## 14. First command

```powershell
pwsh ./scripts/dev-health.ps1
```

Then read `docs/phase4-5-acceptance.md` and `docs/phase4-design-brief.md`.

## Phase 5A completion addendum (2026-07-29)

The former model-metadata P2 gap is closed by the independent
`platform_model_catalog` boundary. Public `/model-catalog`, Pricing metadata,
the minimal Playground hook and `/models/catalog` admin CRUD all use the same
service contract. Prices remain exclusively in `ratio_setting`; channels and
model mappings remain the only routing truth. See
`docs/phase5a-model-catalog.md`, ADR 0007 and `docs/handoff-phase5b.md`.

This addendum supersedes the earlier “do not modify service/model” blanket for
the narrow catalog files and integration points documented in
`docs/upstream-sync.md`; Relay and billing core invariants are still protected.
The next product work is Wallet then Profile, not a second catalog or a broad
Playground rewrite.

## Phase 4.6 addendum — browser test helpers (2026-07-29)

**Phase 5 must not hand-roll theme or locale injection in browser tests.**
Use `web/e2e/helpers/app-state.ts`:

```ts
const page = await newAppPage(browser, { theme: 'dark', locale: 'zhCN' })
await assertThemeApplied(page, 'dark')
await assertLocaleApplied(page, 'zhCN')          // 'console' for authed routes
await signInAsRoot(page, process.env.HYC_LIVE_PASSWORD ?? '')
```

Both mechanisms fail silently if set incorrectly — the theme falls back to
`system` (following `prefers-color-scheme`) and the locale falls back to the
browser context default — so a test that injects state wrongly reports success
while testing nothing. That is not hypothetical: it is what Phase 4 and the
first half of Phase 4.5 actually did.

The helper defends against both by pinning the opposing `colorScheme` and by
asserting locale markers in both directions. Each defence is proven by
deliberate sabotage; see `docs/phase4-6-test-truthfulness.md`.

Also provided: `resetDevRateLimits()`, `cleanupStaleDevSessions()` and
`withRootSession()`. A 429 and `AUTH_SESSION_LIMIT` 409 are reported distinctly
from bad credentials. Every authenticated test must use `withRootSession()` so
formal logout and exact marked-SID cleanup run in `finally`; never clear the
Session table or relax production limits.

## Phase 4.7 addendum — i18n and Session safety (2026-07-29)

The former marketing-copy localization gap is closed. Continue using the
existing flat i18next `translation` resources in
`web/src/i18n/locales/{en,zh}.json`; do not add a second locale system or
hand-write locale conditionals. `web/src/i18n/phase4-i18n.test.ts` guards key
parity, non-fallback zhCN values and interpolation tokens.

The required Phase 5 sequence is unchanged: first close the three launch
blockers (public source URL, approved pricing, nginx verification), then work
through model metadata, wallet/profile, models/playground/subscriptions, and
admin interiors. At every step reuse `newAppPage` plus `withRootSession` and
run the complete mock/live suites before handoff.
