# Phase UI — seekgt alignment, round 4 (corrective)

> **Superseded in part by `docs/phase-ui-seekgt-round5-final-layout.md`.**
> Round 4 fixed routing, devtools and the colour system, and its final visual
> evidence identified eight remaining layout defects. Round 5 closed all eight.
> Two claims below were also corrected there: the working tree was *not*
> strictly clean at the end of round 4 (an untracked evidence directory
> remained), and `type-hero`'s forced `nowrap` combined with round 4's larger
> hero to overflow the English headline by 45px — missed because only document
> overflow was measured, never per-element.

Round 3 does not exist; this follows `docs/phase-ui-seekgt-round2.md` directly.

This round was triggered by the user visiting the running product and finding
defects that the previous round's report had not caught, because that report
reasoned from code structure and test counts rather than from the running site.
Everything below was reproduced against the running instance **before** any
code was changed. The reproduction is in
`artifacts/phase-ui-seekgt-round4/repro-log.txt`.

Start commit `2ca539a`, branch `product/main`, working tree clean.

## What the previous round got wrong, and why

Round 2 reported "rankings complete". The leaderboard page was complete — at
`/rankings`. Nobody had ever loaded `/leaderboard`, because the header linked
`/rankings` and every E2E reached the page by clicking that link. Internal
navigation and direct entry are different code paths in a file-based router,
and only one of them was under test. A passing suite is not evidence that a URL
resolves.

## P0 — reproduced, root-caused, fixed

### 1. `/leaderboard` returned 404

**Root cause:** the route did not exist. `src/routes/` contained `rankings/`
and nothing else. The header, the search-param schema and the page's own
`useSearch({ from: '/rankings/' })` all pointed at `/rankings`.

**Fix:** `/leaderboard` is now the canonical route
(`src/routes/leaderboard/index.tsx`), carrying the module-access and auth
checks. `/rankings` is kept permanently as a compatibility redirect that
forwards search params, so existing links and bookmarks still resolve. The
search schema is shared between them via `routes/leaderboard/-search.ts` so the
two cannot validate differently.

English copy said "Rankings" while the route said `/leaderboard` and Chinese
said 排行榜. That three-way split is what let the defect hide, so the English
value for the `Rankings` key is now "Leaderboard". Chinese is unchanged.

**Verified:** direct entry, `?period=` preservation, legacy redirect, reload,
and the header's `href` — see `e2e/phase-ui-round4-routing.e2e.ts`.

### 2. TanStack Router Devtools visible in review

**Root cause:** mounted for the whole of `MODE === 'development'` in
`__root.tsx`. They were **never** in the production bundle — grepping
`web/dist` finds no devtools chunk. The problem is that `rsbuild.config.ts`
binds port 4173 for **both** `rsbuild dev` and `rsbuild preview`, so the agreed
acceptance URL could be serving either build and a reviewer could not tell
which. The user's screenshots were taken against the dev server.

**Fix:** devtools now require `MODE === 'development'` **and**
`PUBLIC_DEVTOOLS=1`. Default is off everywhere, including development.

### 3. Coloured circular icon, bottom-left

**Root cause:** it is ours, not a browser extension. `ReactQueryDevtools` with
`buttonPosition='bottom-left'`, mounted by the same condition as above. The
same fix removes it.

**Verified:** both overlays are detected structurally (by their mount
containers, not by eye) and report absent on all 56 route × viewport
combinations.

## Colour system

Green was not "over-used"; it was the **surface**. Every neutral token carried
hue 165 — background, surface, foreground, subtle, border, input, muted — and
`--primary` was green, so buttons, links, eyebrows, focus rings and the ambient
wash were all green too.

Roles are now explicit, and defined once in `theme.css`:

| Token           | Role                                                 |
| --------------- | ---------------------------------------------------- |
| `--brand-green` | HYC AI logo and success state. Never a page surface. |
| `--brand-blue`  | Ambient wash, links, secondary emphasis, focus ring  |
| `--brand-violet`| Small amounts of gradient and active accent only     |
| `--primary`     | Near-black: primary CTA and primary controls         |
| `--background`  | `oklch(1 0 0)` — white                               |

`ambient-field` and `text-gradient-brand` were both mixing `--primary`, so they
followed green automatically; they now use the blue/violet pair. The closing
CTA's wash was mixing `--chart-2` and read teal — the last large
green-adjacent area on the home page — and now matches the ambient layer, so
the top and bottom of the page bookend each other.

Nine call sites used `type-label text-primary` for section eyebrows. With
`--primary` near-black those would have become the same colour as the heading
below them, so there is a `text-brand-accent` utility for that role.

**Dark mode is tuned separately, not inverted.** A near-black primary is
invisible on a dark page, so the CTA role flips to near-white — the same "most
contrast against the page" intent — and the brand ramp is lifted for
legibility. Verified `dark=true` on 16/16 dark rows with the browser's
`colorScheme` pinned to `light`, so the cookie is provably what drove it.

## Density and proportion

| Change                    | Before          | After                     |
| ------------------------- | --------------- | ------------------------- |
| `--container-content`     | 76rem           | 84rem                     |
| `type-hero`               | max 3.5rem      | max 4.1rem                |
| `type-section-title`      | max 2.25rem     | max 2.75rem               |
| Home metric values        | `text-4xl`      | `text-4xl/5xl/6xl` + rules|
| Pricing masthead top pad  | `pt-24/sm:28`   | `pt-16/sm:20`             |

At 76rem a 1920px display left roughly 350px of empty gutter per side, which is
the main reason the site read as sparse at large widths.

## Real-data sparsity, handled without fabrication

`/model-catalog` used a fixed `2xl:grid-cols-3`, so with the two models this
deployment actually has, the right third of a 1920px page was empty and the
catalogue looked broken rather than small. The third column now engages only at
three or more results; below that the grid is capped at `max-w-5xl` so two
cards fill their row at a readable size. **No placeholder card, no synthetic
series, no invented count.** The page is also now titled "Model Square" /
模型广场 rather than the ambiguous "模型".

Leaderboard sparsity is unchanged and deliberate: two models over two days.

## An unrelated latent bug this surfaced

`main.tsx` returns `false` from `retry` on the first failure in development but
retries until `failureCount > 3` in production. The catalogue error-state E2E
allowed the default 5s, which is shorter than four attempts plus exponential
backoff — so it passed against a dev server and failed against a production
bundle. The assertion is now sized to the documented retry chain. The retry
policy itself was not weakened to make the test pass.

## Verification

Acceptance origin `http://127.0.0.1:4173` serving the **production preview**
(not the dev server), API on `3001`. `new-api-infra` on 3000 untouched.

| Check                    | Result                                         |
| ------------------------ | ---------------------------------------------- |
| `git diff --check`       | clean                                          |
| `bun run format:check`   | pass (1090 files)                              |
| `scripts/lint-guard.ps1` | 447 violations, baseline 447 — unchanged       |
| `bun run typecheck`      | pass                                           |
| `bun run test`           | 118 passed, 0 failed                           |
| `bun run build`          | pass                                           |
| `go build ./...`         | pass (no Go file changed)                      |
| dev compose config       | valid                                          |
| prod compose config      | correctly refuses `.env.example` (release gate)|
| `dev-health.ps1`         | all OK                                         |
| Playwright               | 128 passed, 12 skipped, 1 intermittent         |

**The intermittent failure is reported, not hidden.** Across three full runs a
different single test failed each time (`phase5c-subscriptions`, then
`phase4-7-i18n` zhCN), and each passes in isolation. Both are authenticated
suites sharing backend state; neither touches the public pages changed here.
This is pre-existing flakiness, and it is not claimed as green.

**Browser matrix, measured not eyeballed:**

- 8 routes × 7 viewports (390, 768, 900, 1024, 1280, 1440, 1920) = 56 rows:
  0 horizontal overflow, 0 devtools overlays, 0 unexpected 404s
  (`viewport-matrix-log.txt`)
- 8 routes × light/dark × zhCN/en = 32 rows: 0 overflow, 0 devtools, 16/16 dark
  rows correct (`theme-locale-matrix-log.txt`)

Evidence: `artifacts/phase-ui-seekgt-round4/`, including before/after pairs and
`visual-findings.json` with route, viewport, severity, reference difference,
root cause, changed file and verification result per finding.

## Still different from SeekGT, and why

Separated by cause, because these are not the same kind of gap:

**From brand — will not change.** HYC AI's mark is green; the logo, success
states and brand chrome stay green. The reference's identity is not ours to
adopt.

**From real data volume — will close on its own.** Two models and two days of
traffic. The leaderboard charts, the catalogue grid and the pricing table are
all built for more rows than exist. Nothing here was padded.

**From capability differences.** The reference advertises protocols and model
families this gateway does not verify. `context_label` is still empty for the
same reason it was in round 2: asserting a context window for an alias whose
upstream route is deliberately hidden, and which nothing here measures, would
be a fabrication.

**Genuinely still weaker, and honest to say so.** The sign-in narrative column
is sparse at 768–1024. The capability panels and three-step row were scaled by
token changes rather than redesigned. And no pixel comparison was performed —
there is no reference image in this repository and no image-diff tool was run,
so nothing here should be read as "one-to-one".

## Needs human or visual confirmation

- Whether the white/blue-cyan/near-black direction now reads closer to the
  reference. That is a visual judgement, and this agent did not make it.
- Whether the widened 84rem container is right for the console as well as the
  public pages — the token is shared.
- Whether "Leaderboard" is the preferred English product term.
