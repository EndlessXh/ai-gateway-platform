# Phase 4.5 — independent product acceptance

Audited 2026-07-29 against a running system. Starting commit
`90f63c8903f1700210734830c7aac2533d62cce6`.

This audit deliberately re-derived every claim rather than inheriting the
Phase 4 corrective report. The acceptance suite
(`web/e2e/phase4-5-acceptance.e2e.ts`) was written from scratch for that
reason. **52/52 pass.**

## Environment actually verified

| Check                  | Result                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| Branch / HEAD          | `product/main` @ `90f63c8` — matched                                 |
| Working tree at start  | clean                                                                |
| Node / Bun             | v22.12.0 / 1.3.14 — matched the report                               |
| `127.0.0.1:3000`       | `com.docker.backend` → protected rc.16 baseline, **not** the product |
| `127.0.0.1:3001`       | product API (`ai-gateway`), loopback only                            |
| `127.0.0.1:4173`       | product frontend (`node`), loopback only                             |
| Frontend LAN exposure  | refused on all 5 local interfaces                                    |
| Baseline still healthy | `/api/status` 200, `success: true`                                   |

The report's claim that these services were running did **not** hold: 3001 and
4173 were both free at handover. Both were started from the repository scripts
for this audit.

## The 20 required checks

| #   | Check                                                                           | Result                     | Evidence                                                                |
| --- | ------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| 1   | Header shows HYC AI, not New API                                                | **PASS**                   | `header, title and footer carry product branding`                       |
| 2   | Footer shows HYC AI product copyright                                           | **PASS**                   | `© 2026 HYC AI. All rights reserved.`                                   |
| 3   | New API only as non-disableable attribution                                     | **PASS**                   | constants in `setting/platform/compliance.go`; no env override          |
| 4   | No upstream brand flash on refresh                                              | **PASS**                   | MutationObserver sampling during reload — 0 samples contained "New API" |
| 5   | Title/favicon/auth/dashboard share one brand                                    | **PASS**                   | title contains "HYC"; console asserts `HYC AI`                          |
| 6   | Public nav hides self-use mode                                                  | **PASS**                   | header matches neither `/self-?use/i` nor `/自用/`                      |
| 7   | `/sign-in` renders a real form                                                  | **PASS**                   | username, password and submit all visible                               |
| 8   | `/sign-up` real form or explicit closed state                                   | **PASS**                   | form present                                                            |
| 9   | `/login` → `/sign-in`                                                           | **PASS**                   | pathname assertion                                                      |
| 10  | `/register` → `/sign-up`                                                        | **PASS**                   | pathname assertion                                                      |
| 11  | Direct URL + reload never 404                                                   | **PASS**                   | 7 routes, navigate + reload each                                        |
| 12  | `/pricing` is not a default New API template                                    | **PASS**                   | see screenshot; product hero, sourced-rates framing, provisional banner |
| 13  | `/pricing` reads only real `/api/pricing`                                       | **PASS**                   | every API model asserted present in DOM                                 |
| 14  | Footer has Docs / Legal / Support / Source / Powered by New API / upstream link | **PASS**                   | "Documentation" is the label, not "Docs"                                |
| 15  | Empty `SOURCE_CODE_URL` produces no fake link                                   | **PASS** (fixed, see P1-1) | no fabricated href                                                      |
| 16  | Unknown route → productised 404                                                 | **PASS**                   | 404 text + recovery links + brand                                       |
| 17  | 404 offers clear recovery                                                       | **PASS**                   | links to `/` and `/pricing`                                             |
| 18  | Dashboard / Keys / Usage Logs share one shell                                   | **PASS**                   | all three, plus reload persistence                                      |
| 19  | No confusion between `:3000` and the product                                    | **PASS**                   | port topology test asserts both origins independently                   |
| 20  | Frontend binds loopback only                                                    | **PASS**                   | all 5 LAN interfaces refused                                            |

Also verified beyond the required list: no upstream model name (`qwen-plus`,
`qwen3.7`) leaks into the public pricing page.

## Findings

### P0 — none

No blocking defect was found. Every P0 candidate from the brief (routing,
branding, pricing source, port crossover, missing attribution) verified clean.

### P1

**P1-1 · Footer exposed deployment state as a warning — FIXED**

- Route: all pages · any viewport · both themes · both languages
- Observed: with `SOURCE_CODE_URL` unset the footer rendered
  "Source code URL pending configuration" in amber warning styling, occupying
  a nav-link slot.
- Root cause: `web/src/components/layout/components/footer.tsx` rendered a
  `text-warning` placeholder in the `else` branch.
- Why it matters: it leaks internal deployment state to end users, reads as a
  broken link, and is exactly the "alarm-styled footer" the design brief
  forbids. It added no compliance value — AGPLv3 §13 is enforced at deploy
  time, where `deploy/compose.prod.yaml` declares `SOURCE_CODE_URL` required
  and `scripts/preflight-release.ps1` fails the release.
- Fix: render the link when configured, nothing when not. Attribution is
  untouched and remains unconditional.
- Verified: re-captured `pricing-desktop-light.png` and `footer-legal.png`;
  footer test still asserts "Powered by New API", the contributor notice and
  the upstream repository link.

**P1-2 · Pricing truncated the model identifier — FIXED**

- Route: `/pricing` · all viewports · both themes
- Observed: card titles rendered `platform-general-p…` and
  `platform-reasoning…`.
- Root cause: `truncate` on the `<h3>` in
  `web/src/features/pricing/components/model-card.tsx`.
- Why it matters: the model name is the exact string a developer copies into
  their client. Platform aliases are long by design (ADR 0003), so the one
  identifier the page exists to communicate was the thing being hidden.
- Fix: `break-all` wrapping plus a `title` attribute, instead of eliding.
- Verified: both names now render in full across viewports; no horizontal
  overflow introduced (overflow tests still pass at all 5 widths).

**P1-3 · Cutover rehearsal orphaned a live process — FIXED**

- Not a UI defect; found while verifying the runtime.
- Observed: an `ai-gateway` process had been listening on `127.0.0.1:3150` for
  ~23 hours, still answering `/api/status`, against a scratch database that had
  already been dropped.
- Root cause: `scripts/rehearse-cutover.ps1` step 8 killed `$proc`, the `pwsh`
  wrapper, not the `ai-gateway.exe` child it launched.
- Fix: kill child processes first, then the wrapper, then sweep anything still
  bound to the rehearsal port, and warn if the port stays bound.
- Verified: orphan terminated; port 3150 released.

### P2 — recorded, not fixed

**P2-1 · `/pricing` shows "No description available." for every model.**
Real gap, but it is _content_, not code: descriptions come from backend model
metadata. ADR 0003 notes aliases are opaque by design and the pricing page must
carry capability and context-window information. Populating that metadata is a
Phase 5 content task.

**P2-2 · Card metadata row is inconsistent between models.** One card shows
latency/TPS/status, the other does not, because only one has traffic. Honest,
but visually uneven at low model counts.

**P2-3 · Two models leave the pricing grid ~35% empty on wide viewports.**
Not egregious at the current card size; revisit if the catalogue stays small.

### Not defects — investigated and dismissed

- **TanStack Router/Query devtools badges** appear in screenshots. They are
  gated behind `import.meta.env.MODE === 'development'` in `__root.tsx`, and a
  production bundle grep for `TanStackRouterDevtools`/`ReactQueryDevtools`
  found nothing. Dev-only overlay, correctly excluded.
- **HTTP 429 during the audit.** Login is protected by the critical rate
  limiter (20 requests / 20 min per IP) and the global limiter; a full suite
  run exhausts both. The limits were **not** relaxed — the acceptance suite
  resets the development counters in `beforeAll`, and the test now
  distinguishes 429 from a genuine auth failure so a limiter trip can never be
  misread as broken login.

- **"Double scrollbar" on console routes — investigated, does not exist.**
  An early version of the audit recorded 2–3 nested scroll containers on
  `/dashboard/overview`, `/keys` and `/usage-logs/common`. Measured directly:

  ```
  /dashboard/overview  document scrolls: false (900 vs 900)
                       real scroll regions: 1  (main content, min-h-0 flex-1 overflow-auto)
  /keys                document scrolls: false
                       real scroll regions: 0
  /usage-logs/common   document scrolls: false
                       real scroll regions: 1  (table body)
  ```

  The document never scrolls and at most one content region does — the correct
  app-shell pattern. The extra containers were the dev-only TanStack devtools
  panels (goober `go<hash>` class names), identical on every route and absent
  from production builds.

  The detector was the bug, not the shell. It now asserts the real invariant —
  the document scrolling _while_ an inner container scrolls — instead of
  counting scrollable elements, and excludes devtools. Both assertions are
  enforced, not merely recorded.

## Corrections to my own audit

Three of my initial assertions were wrong and produced false signals. Recording
them because they would otherwise look like product defects in the history:

1. Theme is stored in a **cookie** (`vite-ui-theme`), not localStorage. My
   first pass set localStorage, so dark mode never applied and produced a
   light-mode screenshot named `-dark`. Fixed, plus an explicit
   `assertResolvedTheme` that checks the `.dark` class rather than trusting the
   cookie.
2. Chinese is `zhCN`, not `zh` (`convertDetectedLanguage`, `web/src/i18n/config.ts`).
   The wrong code silently falls back to English, so the Chinese layout was
   never exercised. Fixed, and the test now asserts Chinese characters actually
   render before judging the layout.
3. Footer label is "Documentation", not "Docs", and two upstream links exist,
   not one. Assertions relaxed to match reality.
4. The scroll-container check counted _any_ scrollable element, so dev-only
   devtools panels registered as a double scrollbar. Rewritten to assert the
   real invariant (see "Not defects" above).

## Matrix coverage

- **Viewports** 390×844, 768×1024, 1280×800, 1440×900, 1920×1080 — horizontal
  overflow checked on `/`, `/pricing`, `/sign-in`, `/sign-up` at every width.
  All clean.
- **Themes** light and dark on `/`, `/pricing`, `/sign-in`. Dark asserted to
  apply the `.dark` class and to be a designed palette — explicitly not pure
  black background or pure white text.
- **Languages** `en` and `zhCN` on `/`, `/pricing`, `/sign-in`. No raw i18n
  keys; Chinese additionally checked for horizontal overflow.
- **Authenticated** `/dashboard/overview`, `/keys`, `/usage-logs/common` —
  brand consistency, no login bounce, no horizontal overflow, nested scroll
  containers counted, reload keeps the route.

## Evidence

`artifacts/phase4-5/` — home (desktop light/dark, mobile), pricing, sign-in
(light/dark), dashboard, keys, footer legal region, 404, and `findings.json`,
which is empty on the final run: every automated finding was either fixed or
shown to be a false positive in the detector.

Screenshots are captured from `bun run dev`, so they include the dev-only
devtools overlays described above.

## Verification run

| Command                                                        | Result                                                |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| `bun run typecheck`                                            | pass                                                  |
| `bun run test`                                                 | 107/107 pass                                          |
| `bun run build`                                                | pass; no devtools symbols in output                   |
| `playwright test phase4-5-acceptance`                          | **52/52 pass**                                        |
| `scripts/lint-guard.ps1`                                       | pass — 447, baseline lowered from 468                 |
| `gofmt -l`                                                     | clean                                                 |
| `go build ./...`                                               | pass                                                  |
| `go test ./model/ ./common/ ./setting/platform/ ./controller/` | pass                                                  |
| dev + prod `compose config`                                    | pass                                                  |
| `scripts/dev-health.ps1`                                       | all green                                             |
| `scripts/dev-smoke-test.ps1`                                   | login, token, non-stream, SSE, logs, quota — all pass |

`new-api-infra` was never modified. It was only read (`/api/status`), and its
container remained healthy throughout.

## Correction — Phase 4.6 (2026-07-29)

The theme and language rows in the coverage matrix above **overstated what was
verified**. The audit's own helper wrote the theme to localStorage while the
application reads a cookie, so both the "light" and "dark" runs rendered light
until the mechanism was corrected mid-audit; and the Chinese check asserted
only that Chinese characters were present, which the browser context default
already satisfied.

The "Corrections to my own audit" section above was also partly wrong: bare
`zh` **does** resolve to `zhCN` via `convertDetectedLanguage`. The real defect
was asserting the default direction, not the locale code.

Phase 4.6 replaced both mechanisms with a shared, sabotage-verified helper and
re-ran the matrix. Everything else in this document — branding, routing,
pricing source, footer legal surface, port topology, overflow — was asserted
correctly and stands.

Detail: `docs/phase4-6-test-truthfulness.md`.

## Correction — Phase 4.7 (2026-07-29)

The en/zhCN matrix now verifies the full Phase 4 product narrative, not only
shared upstream navigation markers. The 95 English fallback values in the
zhCN resource were translated, and render tests cover home, pricing, sign-in,
footer and 404 in both directions. Authenticated acceptance tests now use the
Session-safe fixture and exact-SID cleanup; no test clears ordinary Sessions.

See `docs/phase4-7-i18n-and-e2e-hygiene.md` for the complete audit, five-round
durability result and full-suite record.
