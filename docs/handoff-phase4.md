# Phase 4 handoff

Written 2026-07-28 at the end of Phase 3.5. Everything below was verified on a
running system, not inferred. You should not need to re-investigate Phases 0–3.

## 1. Repository state

| | |
|---|---|
| Branch | `product/main` (`product/develop` tracks the same commit) |
| Working tree | clean at handoff |
| Upstream baseline | New API **v1.0.0-rc.22** |
| Upstream commit | `bc14c18f6024e79cba1c08d02cd007796e12d668` |
| Baseline marker tag | `upstream-baseline/v1.0.0-rc.22` |
| Upstream remote | `https://github.com/QuantumNous/new-api.git` (fetched, never tracked) |

Modified upstream files — keep this list short, see `docs/upstream-sync.md`:

| File | Change |
|---|---|
| `model/log.go` | Strip `upstream_model_name` from non-admin log views |
| `model/log_format_test.go` | Regression test for the above |
| `main.go` | `BIND_ADDRESS` support (4 lines) |
| `README.md`, `CLAUDE.md`, `.gitignore` | Product-owned; upstream README preserved at `README.upstream.md` |

## 2. Stack and commands

React 19 · TypeScript · Rsbuild · TanStack Router/Query/Table · Tailwind CSS 4 ·
Base UI · `next-themes`. Package manager is **bun** (`bun.lock`; npm would
resolve a different graph).

```powershell
pwsh ./scripts/dev-up.ps1          # PostgreSQL 16 + Redis 7
pwsh ./scripts/build-web.ps1       # REQUIRED before any go build (//go:embed web/dist)
pwsh ./scripts/dev-backend.ps1     # API on 127.0.0.1:3001 (loopback only)
pwsh ./scripts/dev-health.ps1      # engine, containers, live DB query, Redis, API
pwsh ./scripts/dev-smoke-test.ps1  # live relay, logs, quota

cd web; bun run dev                # 127.0.0.1:4173 -> API 127.0.0.1:3001
cd web; bun run typecheck          # tsgo
pwsh ./scripts/lint-guard.ps1      # lint ratchet — blocking in CI
```

**The Go binary embeds `web/dist`.** If `web/dist` is missing, `go build`
fails. For UI work use `bun run dev`; you only need `build-web.ps1` before
building the backend.

The dev server uses a strict canonical port. If `4173` is occupied it fails
instead of silently moving to another port. Do not browse `localhost:3000`:
that is the protected rc.16 baseline stack, not this product checkout.

## 3. Routes

Full inventory with priorities: `docs/page-matrix.md`. Source of truth is
`web/src/routes/` (file-based routing; `routeTree.gen.ts` is generated — never
hand-edit it).

**Public:** `/`, `/pricing`, `/pricing/$modelId`, `/rankings`, `/about`,
`/privacy-policy`, `/user-agreement`, `/setup`

**Auth** (`(auth)` group): `/sign-in`, `/sign-up`, `/register`,
`/forgot-password`, `/reset`, `/user/reset`, `/otp`, `/oauth`,
`/oauth/$provider`

**Authenticated console** (`_authenticated` guard): `/dashboard`,
`/dashboard/$section`, `/keys`, `/usage-logs`, `/usage-logs/$section`,
`/wallet`, `/profile`, `/models`, `/models/$section`, `/playground`,
`/subscriptions`, `/chat/$chatId`, `/chat2link`, `/errors/$error`

**Admin:** `/channels`, `/users`, `/redemption-codes`, `/system-info`,
`/system-settings/{site,auth,billing,models,operations,content,security}`

**Errors:** `/401`, `/403`, `/404`, `/500`, `/503`

## 4. File responsibilities

| Concern | File |
|---|---|
| Root route / app shell | `web/src/routes/__root.tsx` |
| Public layout | `web/src/components/layout/components/public-layout.tsx` |
| Public header | `web/src/components/layout/components/public-header.tsx` |
| Public navigation | `web/src/components/layout/components/public-navigation.tsx` |
| Authenticated guard | `web/src/routes/_authenticated/route.tsx` |
| Authenticated layout | `web/src/components/layout/components/authenticated-layout.tsx` |
| App header (console) | `web/src/components/layout/components/app-header.tsx` |
| Sidebar | `web/src/components/layout/components/app-sidebar.tsx` |
| Sidebar nav items | `nav-group.tsx`, `nav-link-item.tsx` |
| Top nav config | `web/src/components/layout/config/top-nav.config.ts` |
| System settings nav config | `web/src/components/layout/config/system-settings.config.ts` |
| Footer | `footer.tsx`, `page-footer.tsx` — **AGPL notices belong here** |
| Brand / system name | `web/src/components/layout/components/system-brand.tsx`, `logo.tsx`, `header-logo.tsx` |
| Mobile navigation | `mobile-drawer.tsx`, `navbar.tsx`, `top-nav.tsx` |
| Theme provider | `web/src/context/theme-provider.tsx` |
| Theme customisation | `web/src/context/theme-customization-provider.tsx`, `web/src/lib/theme-customization.ts` |
| Theme switch UI | `web/src/components/theme-switch.tsx`, `theme-quick-switcher.tsx` |
| Design tokens | `web/src/styles/theme.css`, `theme-presets.css`, `index.css` |
| Pricing feature | `web/src/features/pricing/` (see §7) |
| Sign in / sign up | `web/src/routes/(auth)/sign-in.tsx`, `sign-up.tsx`, `register.tsx` |
| Error pages | `web/src/routes/(errors)/{401,403,404,500,503}.tsx` |

## 5. Safe to modify in Phase 4

- `web/src/styles/*.css` — tokens live here; start here
- `web/src/components/layout/**` — shells, header, sidebar, footer, nav
- `web/src/features/pricing/components/**` — presentation only
- `web/src/routes/index.tsx` — landing page
- `web/src/routes/(auth)/**` — auth screens
- `web/src/routes/(errors)/**` — error pages
- `web/src/components/ui/**` — shared primitives (check every consumer first)

## 6. Avoid modifying

- `relay/**`, `service/**`, `model/**` — relay and billing core. Billing
  invariants in `AGENTS.md` are not negotiable.
- `common/quota_math.go` — quota saturation guards
- `web/src/routeTree.gen.ts` — generated
- `main.go`, `router/**`, `controller/**` — every edit is permanent merge cost
- `LICENSE`, `NOTICE`, `THIRD-PARTY-LICENSES.md` — licence obligations
- `AGENTS.md` — upstream engineering rules
- `web/.oxlint-baseline.json` — only via `scripts/lint-guard.ps1 -Update`

## 7. Reuse, do not rebuild

**Pricing** — the API is the only price source (ADR 0006):

| Purpose | File |
|---|---|
| Data hook | `web/src/features/pricing/hooks/use-pricing-data.ts` |
| API client | `web/src/features/pricing/api.ts` |
| Types | `web/src/features/pricing/types.ts` |
| Price maths | `web/src/features/pricing/lib/price.ts` |
| Model helpers | `web/src/features/pricing/lib/model-helpers.ts` |
| Filters | `web/src/features/pricing/lib/filters.ts`, `hooks/use-filters.ts` |
| Expression pricing | `web/src/features/pricing/lib/billing-expr.ts` |

**Other:** `web/src/components/ui/**` (Base UI primitives),
`web/src/components/data-table/**` (tables, already responsive with mobile card
layout), `web/src/hooks/**`, `web/src/stores/**` (zustand),
`web/src/i18n/locales/*.json` (all user-facing text goes through i18next).

## 8. Known issues to fix in Phase 4

- **Browser tab title is still "New API"** — hardcoded in `web/index.html`.
  This is exactly the mistake the reference site made (see
  `docs/reference-audit.md`). Route it through brand config.
- **No status page route.** Upstream exposes `UptimeKumaUrl` /
  `UptimeKumaSlug` options instead. Decide: first-party page or link out.
- **No API quickstart route.** Guidance is currently scattered across `/keys`
  and `/playground`.
- **468 inherited lint violations** across 194 files, ratcheted (§10). Files
  you touch must not get worse; ideally improve them and lower the baseline.
- **Aliases are opaque by design.** `platform-general-preview` tells a customer
  nothing. The pricing page must carry capability, context window and
  performance information, since there is no recognisable vendor model name to
  lean on.

## 9. Hard requirements for Phase 4

### AGPL footer and source link — not optional

The footer and `/about` must render:

1. `"Frontend design and development by New API contributors."`
2. A visible link to `https://github.com/QuantumNous/new-api`
3. A link to `SOURCE_CODE_URL`
4. The licence name (AGPL-3.0)

Values come from `setting/platform/compliance.go`, where they are **constants,
not configuration**. Brand config must never be able to blank them. Full detail
in `docs/legal-and-source-offer.md`.

`SOURCE_CODE_URL` is not yet wired into the API response — that wiring is
Phase 4's job. The config surface, validation and tests already exist.

### Pricing

One source of truth: `GET /api/pricing`. Do not add a price constant, a second
fetch, or a local calculation. Presentation metadata only (ADR 0006).

### Brand configuration

Working name: **HYC AI** — provisional, not final.

Every name, logo, link and marketing string must resolve from **one central
config module**. No hardcoded brand strings in components. Assume the name will
change; if renaming requires touching more than the config module, the design
is wrong.

Attribution is not brand config and must not be routed through it.

## 10. Suggested order, with verification

Tokens first — everything downstream depends on them. Do not start with the
homepage.

| # | Work | Verify |
|---|---|---|
| 1 | Design tokens in `web/src/styles/theme.css` (colour semantics, spacing, radius, shadow, motion, type scale) | `bun run typecheck`, visual diff in `bun run dev` |
| 2 | Brand config module + route `index.html` title through it | grep for hardcoded brand strings; `pwsh ./scripts/lint-guard.ps1` |
| 3 | Footer with AGPL attribution + source link | `pwsh ./scripts/preflight-release.ps1`; confirm notices render with `SOURCE_CODE_URL` set and unset |
| 4 | Public layout, header, navigation, mobile drawer | `bun run typecheck`; check 320/768/1024/1440 widths |
| 5 | `_authenticated` shell, app header, sidebar | as above |
| 6 | Landing page `routes/index.tsx` | as above |
| 7 | Pricing page presentation (reuse §7 hooks) | confirm displayed price equals `GET /api/pricing` |
| 8 | Sign-in / sign-up / error pages | `pwsh ./scripts/dev-smoke-test.ps1` still passes |

After each step: `pwsh ./scripts/lint-guard.ps1` and `cd web; bun run typecheck`.
Before committing: `pwsh ./scripts/dev-smoke-test.ps1`.

## 11. Launch blockers still open

Run `pwsh ./scripts/preflight-release.ps1` for the live list.

| Blocker | Status |
|---|---|
| **AGPL §13** — source not published, `SOURCE_CODE_URL` unset | Open. Enforcement in place; the publishing is a human task. |
| **Pricing** — `PRICING_STATUS=provisional` | Open. Placeholder ratios (ADR 0005) must be replaced by real commercial pricing. |
| **nginx** — config never syntax-checked | Open. `nginx -t` could not run locally (no container registry route on the authoring machine). CI `deploy-config` job runs it; treat as unverified until green. |
| **AGPL §7(b)** — notices not yet rendered in UI | Open. Phase 4, step 3. |

Production deploys are gated: `deploy/compose.prod.yaml` refuses to start
without `SOURCE_CODE_URL`, and `preflight-release.ps1 -Environment prod` exits
non-zero while any blocker remains.

## 12. Environment state

| Component | State |
|---|---|
| Docker engine | 29.3.1, running. **No route to any container registry** — only cached images work; `docker pull` fails. |
| Platform postgres | `ai-gateway-dev-postgres-1`, PostgreSQL 16.8, `127.0.0.1:5433`, db `aigw`, 34 tables |
| Platform redis | `ai-gateway-dev-redis-1`, Redis 7.4.2, `127.0.0.1:6380` |
| Platform API | `127.0.0.1:3001`, **loopback only** (`BIND_ADDRESS`) |
| Baseline stack | `new-api-dev-*` on port 3000, rc.16 — **read-only, do not modify** |
| Frontend deps | installed (`web/node_modules`, 1110 packages) |
| Go toolchain | 1.25.4 · Bun 1.3.14 · Node 20.18.0 |

Windows/Hyper-V reserves TCP ranges; check with
`netsh interface ipv4 show excludedportrange protocol=tcp` before choosing a
port. 15334–15533 is reserved, which is why postgres uses 5433.

## 13. Secrets

All real credentials live in **environment variables or uncommitted config**:

- `deploy/.env.dev` — gitignored; generate with `scripts/new-secrets.ps1`
- `.platform-tmp/` — gitignored local run artefacts
- Upstream provider keys — in the database, entered via the admin UI or
  `scripts/dev-seed-channel.ps1`; never written to the repository

No secret value is recorded in any document, script or commit. `deploy/.env.example`
contains placeholders only, and CI asserts this.

## 14. First command for the next agent

```powershell
pwsh ./scripts/dev-health.ps1
```

Then read `docs/phase4-design-brief.md` before writing any CSS.
