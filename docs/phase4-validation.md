# Phase 4 validation

Validation date: 2026-07-28

Branch: `product/main`

Baseline before Phase 4: `7a2e716fb9439816c529145e6e75a2e738f76d8f`

Corrective-pass baseline: `972dc785e50bc6e081a0dc352be0cbca184ae31c`

## Corrective audit of the original report

The original Phase 4 report did not describe what a user got from the
documented naked commands. Its browser session manually selected port `4173`
and manually pointed the proxy at `3001`; meanwhile `bun run dev` had no fixed
port, silently moved from occupied `3000` to `3002`, and still proxied API
requests to the protected rc.16 baseline on `3000`. Visiting `localhost:3000`
therefore showed New API, its self-use badge and footer, and returned the
baseline SPA's 404 for `/sign-in` and `/sign-up`.

The checks also asserted loadability and selected DOM details in an ad-hoc
browser session, but did not keep executable direct-navigation and refresh
tests for auth routes, product-brand negative assertions, the footer's separate
upstream attribution, or API-origin pricing data. Finally, Node 20.18 was
described as a non-blocking warning even though it was below the toolchain's
documented minimum. Those omissions made the completion claim unreliable.

The corrective pass fixes this by making `bun run dev` itself canonical:

| Surface | Canonical development endpoint |
|---|---|
| Product frontend | `http://127.0.0.1:4173` (strict; fails on conflict) |
| Platform API | `http://127.0.0.1:3001` |
| Protected baseline | `http://localhost:3000` (read-only; never product acceptance) |

The generated HTML includes `x-platform-source`, `x-platform-commit` and
`x-platform-dev-port` metadata so an acceptance session can prove which
checkout and entry point it loaded. `bun run dev` and `bun run build` now fail
early below Node 20.19 / 22.12.

`self_use_mode_enabled` remains a backend authorization/operation setting; the
corrective pass does not delete or reinterpret it. The public header simply no
longer exposes that internal deployment state. Administrators can still inspect
and change the underlying mode in system settings.

## Original automated checks (historical, superseded)

| Check | Result |
|---|---|
| `pwsh ./scripts/dev-health.ps1` | Passed: Docker, PostgreSQL (34 tables), Redis and API healthy |
| `cd web; bun run format:check` | Passed across 1,055 files; protected headers intact |
| `cd web; bun run typecheck` | Passed |
| `pwsh ./scripts/lint-guard.ps1` | Passed: 447 violations vs 468 allowed; no new debt |
| `cd web; bun test` | Passed: 104 tests across 22 files |
| `go test ./controller ./setting/platform -count=1` | Passed |
| `pwsh ./scripts/build-web.ps1` | Passed; `web/dist` produced (54.6 MB) |
| Dev Compose `config --quiet` | Passed |
| Prod Compose `config --quiet` | Passed with CI-style non-secret placeholder values supplied only for parsing |
| `pwsh ./scripts/dev-smoke-test.ps1` | Passed: admin login, bounded token, non-streaming relay, SSE relay, logs and quota decrement |
| `pwsh ./scripts/preflight-release.ps1 -Environment dev` | Completed with the three expected launch blockers below |
| `pwsh ./scripts/verify-nginx.ps1` | Could not run: `nginx:1.27-alpine` is not cached and Docker has no registry route |

The frontend build completed, while the local Node 20.18 runtime emitted
Rspack's recommendation for Node 20.19+ or 22.12+. CI installs the current Bun
runtime; upgrading local Node removes this non-blocking warning.

## Original browser verification (superseded)

Playwright CLI exercised the live Rsbuild frontend at
`http://127.0.0.1:4173`, proxied to the live API at `127.0.0.1:3001`.

| Surface | Coverage | Result |
|---|---|---|
| Home | 1440×900 light; 390×844 dark | No horizontal overflow; correct HYC AI metadata, truthful hero, theme and footer |
| Pricing | 1440×900 light | Two API-backed models shown; provisional banner visible; no local price source |
| Sign in | 768×1024 light | Form, wrong-password error, successful sign-in and redirect verified |
| Sign up | 768×1024 light | Throwaway development account created; registration-disabled response mocked and closed state verified |
| 404 | 390×844 dark | Correct code, recovery actions and no horizontal overflow |
| Dashboard overview | 768×1024 light | Authenticated shell, sidebar, section context and live account data rendered |
| API keys | 768×1024 light | Authenticated table and empty state rendered |
| Usage logs | 768×1024 light | Authenticated filters/table surface rendered |
| Mobile navigation | 390×844 dark | 44 px targets, open/close, focus trap, Escape and focus restoration verified |
| Footer compliance | Public, auth and pricing routes | Exact attribution, upstream link, AGPL-3.0, missing-source state and mocked configured source link rendered |

This table records what the original report claimed. It is superseded by the
corrective audit and corrective-pass evidence below. The console recorded an expected anonymous `401` from
`/api/user/auth/refresh` before authentication; no uncaught UI exception was
observed. TanStack development tools appear only in the development server and
are not part of the production build.

## Visual artifacts

- `artifacts/phase4/home-desktop-light.png`
- `artifacts/phase4/home-mobile-dark.png`
- `artifacts/phase4/pricing-desktop-light.png`
- `artifacts/phase4/dashboard-tablet-light.png`

## Corrective-pass evidence

The corrective run used Node `v22.12.0`, Bun `1.3.14`, the real platform API
on `127.0.0.1:3001`, and the unmodified command `cd web; bun run dev`. The
frontend started on the strict canonical endpoint `127.0.0.1:4173` and returned
runtime metadata identifying the `ai-gateway-platform` checkout and commit
`972dc785e50b` before the corrective commit was created.

Executable Playwright coverage now asserts content rather than HTTP status:
real sign-in fields, explicit sign-up form/closed state, direct navigation,
refresh, `/login` and `/register` compatibility, NotFound negative assertions,
HYC AI title/header/copyright, distinct New API attribution and repository
link, an intercepted `/api/pricing` source marker, and bounded 2/20/100-model
layouts. A separate opt-in live test signs in with the ignored development
credential and exercises authenticated routes without storing the credential
in source or command arguments.

Corrective screenshots:

- `artifacts/phase4-corrective/before/` — the four reported rc.16 baseline
  failures as actually seen at `localhost:3000`.
- `artifacts/phase4-corrective/after/home-after.png`
- `artifacts/phase4-corrective/after/home-mobile-after.png`
- `artifacts/phase4-corrective/after/pricing-after.png`
- `artifacts/phase4-corrective/after/sign-in-after.png`
- `artifacts/phase4-corrective/after/sign-in-dark-after.png`
- `artifacts/phase4-corrective/after/sign-up-after.png`
- `artifacts/phase4-corrective/after/dashboard-after.png`
- `artifacts/phase4-corrective/after/404-after.png`

### Corrective automated results

| Check | Corrective result |
|---|---|
| `node --version` / `bun --version` | Passed: Node `v22.12.0`, Bun `1.3.14` |
| `cd web; bun run format:check` | Passed across 1,057 files |
| `pwsh ./scripts/lint-guard.ps1` | Passed: 447 violations; 468 allowed; no new debt |
| `cd web; bun run typecheck` | Passed |
| `cd web; bun run test` | Passed: 107 tests across 24 files |
| `cd web; bun run build` | Passed on supported Node; `web/dist` produced (57.25 MB) |
| `go test ./controller ./setting/platform -count=1` | Passed |
| `go build ./...` | Passed |
| Dev and prod Compose `config --quiet` | Passed; non-secret production parse values supplied in-process |
| `pwsh ./scripts/dev-health.ps1` | Passed: Docker, PostgreSQL (34 tables), Redis and platform API healthy |
| `pwsh ./scripts/dev-smoke-test.ps1` | Passed: admin login, bounded token, non-streaming relay, SSE relay, two logs and quota decrement |
| `cd web; bun run test:e2e` with live credential in environment | Passed: 5 tests, including live login and authenticated routes |
| `git diff --check` | Passed |

The first smoke attempt correctly received `429` after the corrective browser
run exhausted the shared development critical-endpoint window. The run waited
for the reported Redis TTL instead of disabling the limiter, then passed in
full. The live test was changed to perform one login, one refresh, and SPA
navigation so the test itself no longer burns the window with repeated hard
reloads.

### Corrective browser matrix

| Surface | Viewport / mode | Result |
|---|---|---|
| Home | 1440×900, light, zh-CN | HYC AI title/header/copyright, full product narrative, configured `/v1`, separate New API attribution, no self-use badge, no overflow |
| Pricing | 1440×900, light, zh-CN | Two live API models, provisional state, input/output comparison, compact full-width layout, no upstream desktop sidebar |
| Pricing fixtures | Desktop, 2 / 20 / 100 API models | 2-model page stays bounded; 20 cards fit the page; 100 models paginate at 20; no overflow |
| Sign in | 768×1024, light, zh-CN | Real username/password controls; direct URL and refresh; never NotFound |
| Sign up | 768×1024, light, zh-CN | Real registration controls (or tested closed-state fixture); direct URL and refresh; never NotFound |
| Legacy auth | 768×1024, light, en | `/login → /sign-in`; `/register → /sign-up` |
| 404 + random route | 768×1024, light, en | Product shell, error number, Home/Console/Docs/Sign-in recovery and compliance footer |
| Mobile home | 390×844, dark, zh-CN | Full content, HYC AI, no public self-use label and no overflow |
| Dark sign in | 768×1024, dark, zh-CN | Real form, product brand and compliance footer |
| Dashboard overview | 1440×900, light, en | Live admin login, hard refresh preserved session, HYC AI shell and live account data |
| API keys / usage logs | 1440×900, light, en | Authenticated SPA navigation to `/keys` and `/usage-logs/common`; no auth or NotFound fallback; no overflow |

## Launch blockers

1. `SOURCE_CODE_URL` is empty. Publish the exact modified source and configure
   its public HTTPS URL to satisfy AGPLv3 section 13.
2. `PRICING_STATUS` is not approved. Replace provisional development ratios
   with commercially approved pricing before charging users.
3. nginx remains syntax-unverified locally because the required image cannot
   be pulled. Treat it as unverified until the CI `deploy-config` job passes or
   `scripts/verify-nginx.ps1` succeeds on a machine with the image.

The former AGPL §7(b) UI blocker is closed: attribution and source-offer state
now render in the product footer. No Phase 5 work is included.

## Phase 4.5 independent acceptance (2026-07-29)

An independent audit re-verified this pass against a running system rather than
trusting the report above. Result: **52/52 acceptance checks pass**, no P0.

Three defects were found and fixed:

1. Footer rendered `SOURCE_CODE_URL` deployment state as an amber warning to
   end users (P1). Now renders the link when configured and nothing when not;
   AGPL attribution is unchanged and still unconditional.
2. `/pricing` truncated the model identifier to `platform-general-p…` (P1) —
   the one string a developer must copy. Now wraps in full.
3. `scripts/rehearse-cutover.ps1` orphaned its Go child process, leaving a
   service listening on port 3150 for 23 hours against a dropped database (P1).
   Now kills the child, then the wrapper, then sweeps the port.

Three of the audit's own initial assertions were also wrong and are corrected
in `web/e2e/phase4-5-acceptance.e2e.ts`: theme is a cookie not localStorage,
Chinese is `zhCN` not `zh`, and the footer label is "Documentation" not "Docs".
The first two meant dark mode and Chinese were not actually being exercised.

Full record: `docs/phase4-5-acceptance.md`.

## Correction — Phase 4.6 (2026-07-29)

**The dark-mode and Chinese coverage claimed above was not real.** An
independent repair pass found the browser tests were not entering either state:

- theme is a **cookie** (`vite-ui-theme`), not localStorage, and its default is
  `system` — so a missing or invalid value silently follows
  `prefers-color-scheme` rather than failing;
- the locale check only asserted "Chinese characters are present", which
  whichever locale is the context default already satisfies;
- `phase4-runtime.e2e.ts` and `phase4-live-runtime.e2e.ts` contain **no theme
  or locale injection at all**, so Phase 4 never covered these dimensions.

All browser tests now go through `web/e2e/helpers/app-state.ts`, which pins the
opposing `colorScheme` so the theme can only come from a correctly-read cookie,
and asserts locale markers in both directions. Each defence was proven by
deliberate sabotage (see `docs/phase4-6-test-truthfulness.md`).

Also corrected: `phase4-runtime.e2e.ts` still asserted the footer showed
"Source code URL pending configuration", which Phase 4.5 removed as a defect —
that commit shipped with a broken pre-existing test because only the new suite
was run.

Current state: 88/88 across all three e2e files.

## Correction — Phase 4.7 (2026-07-29)

The remaining Phase 4 localization and E2E Session-lifecycle gaps are closed.
Ninety-five zhCN resource entries that still equalled their English source now
have natural Chinese copy, localized SEO descriptions update on locale change,
and scoped resource/render guards prevent fallback regressions.

Authenticated tests now mark every Session, formally log out, and delete only
their own exact marked SID in `finally`. The unsafe whole-table dev reset was
removed. Five consecutive two-worker authentication rounds left the original
ordinary Session record unchanged and produced no 409. Full results and design:
`docs/phase4-7-i18n-and-e2e-hygiene.md`.
