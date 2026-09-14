# Next UI pass — handoff

Follows `docs/phase-ui-seekgt-alignment.md`, `docs/phase-ui-seekgt-round2.md`,
`docs/phase-ui-seekgt-round4-corrective.md` and
`docs/phase-ui-seekgt-round5-final-layout.md` (there is no round 3).
Everything below is a real remaining gap, ordered by how much it improves the
product.

**The UI alignment phase is closed as of round 5.** All eight D-class layout
defects are fixed with before/after measurements, and 224 browser rows report
clean. What remains below is either blocked on data, blocked on measurement, or
a deliberate brand difference — none of it is a layout defect.

Round 4 fixed the `/leaderboard` 404, removed the devtools overlays, and
rebuilt the colour system around white / blue-cyan / near-black with green
demoted to the brand mark. Round 5 closed the layout gaps and retuned
`section-block`, `type-hero`, `type-page-title` and `type-section-title`. Read
both before touching tokens.

## 0. Read this first

**Verify against the running product, not against the suite.** `/leaderboard`
returned 404 for three consecutive rounds while every check was green, because
tests navigated by click and nobody typed the URL. Two devtools overlays
rendered on every development page for just as long.

**Know which build port 4173 is serving.** `rsbuild.config.ts` binds 4173 for
both `dev` and `preview`. They behave differently in ways that matter: query
retries are disabled in dev and run four attempts in prod, and devtools only
exist in dev. Acceptance means the **preview** build.

**Measure elements, not just the document.** Four rounds reported "no
horizontal overflow" while the English hero `h1` overflowed its own column by
45px, because only `documentElement.scrollWidth` was ever checked. Round 5's
matrix also checks `h.scrollWidth > h.clientWidth` per heading. Keep that.

**CJK headings need `word-break: keep-all`.** Chinese has no inter-word spaces,
so a wrapped heading can break between any two glyphs — and `text-wrap:
balance` aims for the midpoint, which is usually mid-compound. The type
utilities set `keep-all` with `overflow-wrap: anywhere` as the escape hatch.
Do not remove either half.

## 1. `context_label` is blocked on measurement, not on effort

The catalogue card renders a context-window row only when `context_label` is
non-empty, and it is empty for both platform aliases. This was left empty
deliberately: the aliases hide their upstream route by design, and nothing in
this deployment measures a context window, so any value would be an assertion
we cannot support.

To actually fix it, pick one and do it properly:

- record the real context window per upstream model alongside the channel's
  `model_mapping`, and derive the label from that; or
- expose the value the upstream provider returns and cache it.

Do **not** hardcode a lookup table of context windows in the frontend, and do
not copy figures from provider marketing pages.

## 2. Rankings density

Structurally aligned. Revisit only once there is real traffic: with two days of
data across two models the charts look sparse no matter how they are styled.
When you do, the reference's two-column leaderboard list is the specific thing
to copy. Do not pad the series with synthetic points to make it look busier.

## 3. Colour roles are new — extend them, do not bypass them

`--brand-green` / `--brand-blue` / `--brand-violet` / near-black `--primary`
are defined once in `theme.css`. The failure mode to avoid is a component
hardcoding a colour because a token "looked wrong": the previous palette went
green everywhere precisely because `ambient-field` and `text-gradient-brand`
mixed `--primary` and inherited its hue silently.

Dark mode is tuned separately, not inverted. `--primary` is near-white there.

## 4. Header behaviour is still an undecided accident

The header collapses to a floating pill on scroll; the reference uses a
fixed-height bar with a hairline bottom border. Round 2 verified that the
header and footer are applied consistently across every public route but did
not settle this. It works and is arguably nicer — decide deliberately, and
write the decision down either way.

## 5. Pricing card descriptions

Pricing cards still fall back to "No description available" for models without
a `description` on the pricing payload, even though the catalogue holds
`description_en` / `description_zh_cn` for the same model. Joining the two is a
backend change in the pricing serialiser, not a frontend one — the frontend
must not maintain a second description source.

## 6. Chart geometry has no automated coverage

`barMaxWidth` on the leaderboard charts is the one round-5 fix without a
regression test: VChart renders to `<canvas>`, so bar geometry is unreadable
from the DOM and no screenshot-diff tooling exists here. If low-cardinality
rendering regresses, only a human will notice. Setting up image diffing would
close this and D5 together.

The two flaky authenticated suites reported in round 4 were both root-caused
and fixed in that round (a strict-mode substring collision, and a locale
assertion that raced i18n hydration). Three consecutive full runs since have
been clean.

## 7. No pixel comparison has ever been performed

This is the one thing that has never been done in five rounds. The SeekGT
reference screenshots are not stored in this repository and did not survive
context compaction, so every statement about the reference in `docs/` is
second-hand. Nothing in this project should be described as "one-to-one".

Closing this needs a human to compare
`artifacts/phase-ui-seekgt-round5/*-after.png` against the reference images
once, or to accept the remaining A/B/C differences as final.

(The tablet auth layout listed here previously was fixed as D3 in round 5:
768×1024 fill went from 36% to 74%.)

## Rules that must not be relaxed

- **Every public route needs a direct-entry test.** Add it to `PUBLIC_ROUTES`
  in `e2e/phase-ui-round4-routing.e2e.ts`. Clicking a link and typing a URL are
  different code paths, and only testing the first is how `/leaderboard`
  stayed broken for three rounds.
- **Devtools stay opt-in.** `PUBLIC_DEVTOOLS=1` plus development mode. Do not
  restore the unconditional `MODE === 'development'` mount.

- **Do not fabricate metrics.** The metrics band is derived from the catalogue.
  If a number cannot be derived, do not display it. The previous `50+ / 100+`
  values were copied marketing claims and were removed for that reason. The
  same rule is why `context_label` is empty.
- **Pricing has one source of truth** — `GET /api/pricing` (ADR 0006). Never add
  a second price number.
- **Attribution is not brand config.** Footer and `/about` must keep the AGPL
  notice and upstream link. Round 2 removed a _duplicate_ link to the same
  repository; it did not remove an element. Do not remove another one.
- **Use the E2E helpers** in `web/e2e/helpers/app-state.ts` for theme and
  locale. Hand-rolled injection silently no-ops; see
  `docs/phase4-6-test-truthfulness.md`.
- **`facetCounts` semantics**: count against every filter _except_ the facet's
  own dimension. Changing this quietly breaks the counts.
- **A negative-`z` ambient layer needs a transparent parent.** Adding
  `bg-background` to a wrapper that hosts `ambient-field` silently hides it.
  This has now cost two rounds; `body` already paints the background.
- **Port 4173 serves the built bundle**, not a dev server. Source edits are not
  visible there until `bun run build` runs. Verifying against a stale bundle is
  the easiest way to report a fix that was never shipped.

## Verify after each step

```powershell
cd web; bun run format:check; bun run typecheck; bun run test
pwsh ./scripts/lint-guard.ps1
cd web; bun run build; bunx playwright test
```

Note that the editor's format-on-save writes double quotes while the project's
Prettier config expects single quotes, so `bun run format` before
`format:check` is routine rather than a symptom.

Launch blockers are unchanged: `SOURCE_CODE_URL` unset, `PRICING_STATUS`
provisional, nginx never syntax-checked in a real environment.
