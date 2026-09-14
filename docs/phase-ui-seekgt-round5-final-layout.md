# Phase UI — seekgt alignment, round 5 (final layout)

Closes the SeekGT alignment work. Scope was fixed in advance: the eight
D-class layout issues that round 4's final visual evidence identified, and
nothing else. No redesign, no new UI goals, no page rewrites.

Start commit `00dd6cf` on `product/main`. Frontend only — no Go file changed.

## Untracked evidence from round 4

`git status` at the start showed `?? artifacts/phase-ui-seekgt-final-visual/`.
The previous round's report called the tree clean, which was wrong: no tracked
file was modified, but that directory was untracked and unmentioned in the
headline.

It has been **committed**, not ignored. That matches the repository's existing
convention without exception: thirteen `artifacts/phase-*` directories are
already tracked and `.gitignore` has no artifacts rule. The directory holds 26
screenshots, `capture-manifest.json` and `visual-comparison.md`, all of which
`docs/` now references. Nothing was deleted or overwritten.

## D1 — Chinese section headings broke mid-compound at 1920

Two independent causes, both fixed.

The title column in `side` mode was `0.8fr`, which resolved to **502px at both
1440 and 1920** because `--container-content` caps at 84rem — while
`type-section-title` kept growing with `vw`, 42px to 44px. Same box, bigger
type. The ratio is now inverted to `1.15fr/0.85fr` (the heading is the primary
element; the lede is one short sentence) and the heading cap raised to
`max-w-3xl`.

That alone was not enough. Chinese has no inter-word spaces, so once a heading
wraps the break can land between any two glyphs, and `text-wrap: balance`
actively aims for the midpoint — producing `两种请求格式，一` / `个统一管控的网关`,
split inside the compound 一个. `word-break: keep-all` removes the break
opportunity between Han characters, leaving punctuation as the preferred break;
`overflow-wrap: anywhere` is the escape hatch so an unbreakable run can never
overflow instead.

Measured after: one line at 1280 and 1440; at 1920 it breaks as
`两种请求格式，` / `一个统一管控的网关` — at the comma.

### A second overflow this uncovered

Checking every heading against its own box (not just the document) exposed a
defect that had been present since round 4 and that four previous rounds of
"no horizontal overflow" had missed, because they only measured the document:

`type-hero` forced `text-wrap: nowrap` above 40rem. Round 4 then raised the
hero to 4.1rem. In English at 1440 the `h1` needed **688px inside a 643px
column** — 45px spilling into the gap beside the request card. The brief's own
D1 criteria forbid exactly this ("不允许全局强制 nowrap 导致溢出"), so `nowrap`
is gone. The authored two-line rhythm no longer depends on it: `keep-all`
protects the Chinese lines, and each authored line is short enough to hold.

## D2 — Pricing rendered two cards into a three-column grid

`gridTemplateColumns` was `416px 416px 416px` with two cards, so 432px — 34% of
the row — was blank on the right, identically at 1440 and 1920. The catalogue
had been fixed in round 4, but with inline logic that pricing never got.

Both now call one shared helper, `resultGridClass(count)`. Capped widths are
**centred**; that is the part that actually fixes the look, since capping alone
just relocates the blank space.

| Route | Before | After |
| --- | --- | --- |
| `/pricing` | `416px 416px 416px`, 848/1280, 432px empty right | `566px 566px`, 1152/1280, 64px each side |
| `/model-catalog` | `486px 486px`, 992/992 (already fixed) | unchanged, now via the shared helper |

No placeholder card, no transparent column filler, no fabricated model.

## D3 — Sign-in was mostly empty at tablet portrait

The narrative column was `lg:flex`, so between 768 and 1023 it disappeared
entirely and the form card floated in the middle of an empty column: **36%
fill, 309px of dead space above and below**.

It is now a full-width band above the form at tablet widths and the left column
from `lg` up — the same markup in both, so the copy is not duplicated. Below
`md` it stays hidden: at 390 the form must come first.

| Viewport | Before | After |
| --- | --- | --- |
| sign-in 768×1024 | 36% | **74%** |
| sign-up 768×1024 | — | 78% |
| sign-in 820×1180 | — | 71% |
| sign-in 1024×768 | — | 100% (side by side) |
| sign-in 390×844 | form first | form first, unchanged |

No authentication behaviour was touched: OAuth, Passkey, captcha,
forgot-password, the `redirect` param, Session handling and error states are
all as they were.

## D4 — Leaderboard masthead

**Left alignment was kept deliberately**, because the reference leaderboard is
left-aligned. This was not "make it match the other pages".

What was wrong was the type scale: a one-off `clamp(1.75rem, 4vw, 2.5rem)` that
existed nowhere else, so the leaderboard title rendered visibly smaller than
every other page title. It now uses the shared `type-page-title` with the
standard eyebrow and lede, which also settles its vertical rhythm against the
panels below. Its `h1` font size now equals the catalogue's to within 1px.

## D5 — Two dates rendered as two slabs

A band scale divides the plot area by category count, so at two categories each
bar took roughly 30% of the chart width and the panel read as broken rather
than sparse. `barMaxWidth: 64` is set on both the models-history and
market-share specs. The cap only binds at low cardinality — at 7, 30 or 365
points the natural width is already below it.

**This is the one item in this round with no automated regression test.**
VChart renders to `<canvas>`, so bar geometry is not readable from the DOM, and
no screenshot-diff tooling is set up here. It is verified in the after
screenshots only. No data point was added, removed or interpolated.

## D6 — About masthead

About already used the shared `type-label` and `type-page-title`. The real
inconsistency was vertical rhythm: three public pages had three different
masthead paddings (`py-16 sm:py-24`, `pt-24 pb-16 sm:pt-28`, and pricing's
round-4-tuned `pt-16 pb-12 sm:pt-20 sm:pb-16`). All three now use pricing's.

Left-aligned product narrative retained. New API attribution, AGPL and the
upstream repository link are unchanged.

## D7 — Section spacing at large widths

`section-block` was `clamp(4rem, 8vw, 7.5rem)`, which put **205px at 1280,
230px at 1440 and 240px at 1920** between adjacent sections.

Now `clamp(4rem, 5.2vw, 5.25rem)`:

| Width | Before | After |
| --- | --- | --- |
| 1280 | 205px | 134px |
| 1440 | 230px | 150px |
| 1920 | 240px | 168px |
| 768 / 390 | 128px | **128px, unchanged** |

The `4rem` floor is deliberately untouched, so this is provably a large-screen
correction only.

## D8 — Panel and step weight at 1920

The grid expressed hierarchy through span alone; nothing expressed it through
type or density, so at 1920 the section read as 1440 content stretched across a
wider canvas.

`PublicFeaturePanel` gained an explicit `emphasis` flag, set on the two
`col-span-7` panels — title `text-lg/xl/2xl` against `text-base/lg`, body
`lg:text-base`, padding `p-6 lg:p-7 xl:p-8`. The step markers go `size-12` to
`lg:size-16`, glyphs `size-5` to `lg:size-7`, titles to `lg:text-xl`, copy
width `max-w-xs` to `lg:max-w-sm`. Every step is `lg`-gated, so 390 and 768 are
untouched.

The structural claim — that primary and secondary panels are now distinguished
in the component API rather than by span alone — is verified. Whether the
resulting weight matches the reference is a visual judgement and is not claimed.

## Verification

Acceptance origin `http://127.0.0.1:4173` serving the **production preview**,
API on `3001`. `new-api-infra` on 3000 untouched.

Browser matrix: 8 routes × 7 viewports (390 / 768 / 820 / 1024 / 1280 / 1440 /
1920) × light+dark × zhCN+en = **224 rows**. Full results in
`artifacts/phase-ui-seekgt-round5/capture-manifest.json`.

## What is left, by cause

**A — brand (1).** Green is the HYC AI mark and success state only; the page
surface is white. Not a gap to close.

**B — real data volume (5).** Two models and two days of history. The
leaderboard charts, catalogue grid and pricing table are all built for more
rows than exist. Nothing was padded to hide it.

**C — capability (2).** `context_label` stays empty — asserting a context
window for an alias whose upstream route is deliberately hidden, and which
nothing here measures, would be a fabrication. Two request protocols rather
than a vendor matrix.

**D — layout (0).** All eight closed, each with a before and after measurement.

**E — functional (0).**

## Is the UI alignment phase finished?

**Yes, with one honest caveat.** Every measurable defect identified from the
running product is closed and covered by a regression test, except D5 for the
canvas reason given above.

The caveat is unchanged from round 4 and cannot be resolved by this agent: **no
pixel comparison against the SeekGT reference has ever been performed in this
repository.** The reference screenshots are not stored here and did not survive
context compaction, so every statement about the reference in these documents
is second-hand from `docs/phase-ui-seekgt-alignment.md`. Nothing here should be
read as "one-to-one".

Closing the phase formally needs a human to compare
`artifacts/phase-ui-seekgt-round5/*-after.png` against the reference images once.

## Conditions for resuming Phase 6A (Provider Validation)

1. A human confirms the round-5 after-screenshots against the reference, or
   accepts the remaining A/B/C differences as final.
2. The launch blockers are unchanged and still apply: `SOURCE_CODE_URL` unset,
   `PRICING_STATUS` provisional, nginx never syntax-checked in a real
   environment.
3. Phase 6A must not reopen public-page layout. If it needs a UI change, that
   is a separate scoped round.
