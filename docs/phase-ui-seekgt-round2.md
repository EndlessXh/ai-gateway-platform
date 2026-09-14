# Phase UI — seekgt alignment, round 2

Continues `docs/phase-ui-seekgt-alignment.md`. Round 1 rebuilt the hero, the
metrics band and the model catalogue and then ran out of room. This round
closed the items that round explicitly listed as unfinished, in the order they
were prioritised.

Baseline commit: `3ddad4d` on `product/main`. Frontend only — no Go file was
touched, so the backend, relay, billing and provider layers are unchanged.

## Delivered

### P0-1 — Home below the fold

The four sections after the metrics band were the weakest remaining stretch:
uniform icon cards where the reference uses composite panels, and a dark banner
where it closes with a centred block.

- `features.tsx` — the six-cell uniform grid became four asymmetric panels on a
  12-column grid (7/5, 5/7), each with an internal visual rather than an icon:
  request-format chips, a token-control list, alias rows, and a four-cell
  visibility grid. A four-icon supporting row follows with no card chrome, so
  the section has two densities instead of one.
- `how-it-works.tsx` — four equal cells condensed to three numbered circular
  steps with a horizontal connector (three-column layout only; on mobile the
  steps stack and a rule would be meaningless). Every step links to a real
  route: `/keys`, `/model-catalog`, `/usage-logs`.
- `cta.tsx` — the solid dark slab became a centred block over a radial wash,
  with the second heading line carrying `text-gradient-brand`. It reuses the
  existing brand gradient rather than introducing a second gradient vocabulary.
- New shared module `web/src/components/public/section.tsx`
  (`PublicSectionHeader`, `PublicFeaturePanel`, `PublicChip`) so marketing
  sections stop re-declaring eyebrow/title/lede markup.

### P0-2 — Rankings

> **Corrected by round 4.** This section says rankings was completed. The page
> was complete at `/rankings`, but `/leaderboard` — the URL a user actually
> types — returned 404, and no test ever loaded it because the header linked
> `/rankings` and every E2E navigated by click. See
> `docs/phase-ui-seekgt-round4-corrective.md`.

Structurally the page already matched the reference (period tabs, models,
market share, pulse). What was wrong was that it painted its **own** blue and
purple radial stack, giving it a different atmosphere from every other public
route and introducing a purple hue that exists nowhere else in the palette. It
now inherits the shared `ambient-field` and uses `page-container`, so its width
matches the rest of the site instead of a bespoke `max-w-[1280px]`.

### P0-3 — Pricing

The page had the right parts but opened left-aligned while `/model-catalog` —
the same kind of catalogue entry point — opened centred. The masthead, lede and
search bar are now centred to match. The provisional-pricing banner, the
toolbar and all Pricing API semantics are untouched.

### P1-4/5 — Sign-in and sign-up

- `auth-layout.tsx` now carries the public site's `ambient-field`, so signing
  in reads as part of the same product instead of a detached form page. The
  wrapper's redundant `bg-background` was removed — `body` already paints it,
  and an opaque background there occludes the negative-`z` ambient layer. This
  is the same trap that hid the ambient wash in round 1.
- Both headings were `text-center ... sm:text-left` while the subtitle directly
  beneath them was `text-left`, so the two lines disagreed on mobile. Both are
  now consistently left-aligned.

No identity functionality was changed: OAuth, Passkey, captcha, forgot-password,
the `redirect` search param and session handling are all as they were.

### P1-6 — Header and footer

Every public route resolves through `PublicLayout` and every auth route through
`AuthLayout`; that was already true and was verified rather than changed.

The footer's attribution block linked the **same** upstream repository twice —
"Powered by New API" and "Original project: New API" pointed at the same URL,
costing three lines for no compliance value. It is now one line carrying the
project name, the repository link and the licence link, plus the §7(b)
attribution notice. Every AGPL-required element is still rendered
unconditionally. `'Original project:'` was dropped from `static-keys.ts` with
its last caller.

### P1-7 — Model metadata

The real defect was in the catalogue's facet sidebar. `Category`, `Provider`
and `Capability` had no `labelFor`, so they rendered raw identifiers —
`general`, `platform`, `streaming`, `json_mode` — in **both** languages, while
`Pricing type` and `Status` next to them rendered properly. The card body was
already calling `t()`; only the facets were missed.

Capability and modality keys are a closed enum defined in
`model/platform_model_catalog.go`, and every value already had an en/zh entry,
so this needed no new data. Provider facets carry `provider_key`, not the
catalogue's `provider_label`, so only keys the catalogue actually defines are
translated; anything else falls through to the raw key rather than being
guessed at.

**`context_label` is deliberately still empty.** Filling it would mean
asserting a context window for an alias whose upstream route is intentionally
hidden and which nothing in this deployment measures. The card already guards
with `model.context_label ? …`, so the row simply does not render. An invented
"128K" would pass every check in this repository and be a lie.

For the same reason nothing was added to the seed: `dev-seed-model-catalog.ps1`
already carries display name, provider label, both descriptions, category,
capabilities, modalities, icon, badge, availability, recommended and sort
order, it is already idempotent, and it already writes no prices and no
channels.

## Honest limits

- **No pixel-level comparison was performed.** There is no reference screenshot
  in this repository and no image-diff tool was run. Claims here are about
  structure, rhythm and density, not pixel equivalence.
- Rankings still look sparse. That is a **data** limitation — two models over
  two days — not a layout one, and no placeholder series was invented to hide
  it.
- The metrics band reads 2 / 1 / 2 / 2 because those are the real derived
  counts on the dev dataset. No `50+`-style figure was reintroduced.

## Verification

Run against the built bundle at `http://127.0.0.1:4173` with the backend on
`3001`. `new-api-infra` on port 3000 was not touched.

| Check                    | Result                                     |
| ------------------------ | ------------------------------------------ |
| `git diff --check`       | clean                                      |
| `bun run format:check`   | pass (1086 files)                          |
| `scripts/lint-guard.ps1` | 447 violations, baseline 447 — no new debt |
| `bun run typecheck`      | pass                                       |
| `bun run test`           | 118 passed, 0 failed                       |
| `bun run build`          | pass                                       |
| `bunx playwright test`   | 125 passed, 12 skipped, 0 failed           |
| Go toolchain             | not run — no Go file changed this round    |

Screenshot evidence: `artifacts/phase-ui-seekgt-round2/`. The `before-*` files
are the pre-round-2 state of the home, pricing and sign-in pages; the `r2-*`
files are the final state — 14 captures across
`/`, `/pricing`, `/model-catalog`, `/rankings`, `/sign-in`, `/sign-up`,
`/about` at 390 / 1440 px, in light and dark, in `zhCN` and `en`. Every capture
reports `overflow=false`, and each dark capture was taken with the browser's
`colorScheme` pinned to `light` so a passing `dark=true` proves the cookie
drove the theme rather than the OS preference. `capture-log.txt` holds the
measurements.

### One test was updated, not deleted

`phase4-7-i18n.e2e.ts` asserted the home page renders `'Streaming responses'`
and `'Extensible channel layer'`. The `features.tsx` rewrite retired both
strings, so the test failed for a legitimate reason. It now asserts
`'Built for developers, observable end to end'`, `'Routing architecture'` and
`'Open to extension'` — the copy that replaced them in the same region of the
page — keeping the test's purpose intact.

## Needs human or visual confirmation

- Whether the composite panels and the three-step row read as closer to the
  reference. That is a visual judgement this agent cannot make.
- The Chinese hero and CTA line breaks at intermediate widths between 390 px
  and 1440 px; only those two widths plus 768 px were captured.
- Whether the condensed footer attribution still satisfies the project's
  interpretation of its §7(b) obligation. The elements are all present; the
  presentation changed.
