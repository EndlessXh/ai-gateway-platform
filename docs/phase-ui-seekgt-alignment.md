# Phase UI — seekgt visual alignment

Starting commit `ac3392cd7e152b3391bfe2ef398ae955eb9c5ce2`. Scope: public-site
presentation only. No backend, relay, billing, provider or `new-api-infra`
change.

> **Round 1 of two.** This round rebuilt the hero, the metrics band and the
> model catalogue, then ran out of room. The sections it lists below as
> unfinished — the home page below the fold, rankings, pricing, the auth pages
> and the catalogue facets — were completed in
> `docs/phase-ui-seekgt-round2.md`; the colour system, routing and density were
> corrected in `docs/phase-ui-seekgt-round4-corrective.md`; and the final eight
> layout defects were closed in `docs/phase-ui-seekgt-round5-final-layout.md`.
> There is no round 3. **Read round 5 for the current state.** The "Honest
> limits" section here still applies, and the green-forward palette described
> below no longer reflects the product.

## What the gap actually was

The reference is a bright, gradient-atmosphere product site; this project was a
restrained typographic one. Six concrete differences drove the work:

1. **No ambient layer.** Flat surface plus a grid overlay, versus a soft
   blue→teal wash behind the hero.
2. **Hero composition.** Reference: pill badge → two-line headline with an
   accented second line → subhead → three CTAs → ecosystem row. Ours: eyebrow →
   a headline that wrapped to five lines → three CTAs → a thin `<dl>`.
3. **Request card.** Reference has tabs, a method chip, labelled REQUEST and
   RESPONSE blocks and a meta footer. Ours had two tabs and one code block.
4. **Missing home sections**, notably a metrics band.
5. **Model catalogue** — the largest gap. Reference: centred masthead, centred
   search, sticky multi-dimension facet sidebar with counts, results toolbar,
   card grid, pagination. Ours: one row of four `<select>` elements.
6. **About** was a "not configured" construction notice.

## Delivered

### Design tokens (`web/src/styles/index.css`)

| Utility                                 | Purpose                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `ambient-field`                         | Single radial wash for the whole public shell, masked to fade by mid-page |
| `text-gradient-brand`                   | Accent for the second headline line, inside the brand ramp                |
| `type-hero`                             | Hero headline sized so **both** locales land on two lines                 |
| `surface-panel`                         | Elevated card used by the hero request demo                               |
| `section-block` / `section-block-tight` | Shared vertical rhythm                                                    |

`type-hero` exists because `type-display` tops out at 5.75rem, which is tuned
for Latin copy: CJK glyphs are full-width, so a Chinese headline ran to four
lines in the hero column. It also sets `text-wrap: nowrap` above 40rem so an
authored two-line headline cannot silently re-wrap, with the constraint dropped
on narrow screens.

The ambient layer initially rendered nothing. A negative-`z-index` child paints
_behind_ its parent's own background, and `PublicLayout` carried a redundant
`bg-background` that `body` already provides. Removing it fixed the layer.

### Hero

Badge pill, two-line headline with a gradient second line, subhead, primary /
outline / ghost CTAs, and a compatibility row.

The reference places client logos in that row. We list the two request surfaces
the gateway actually relays, with their paths — the same reassurance without
implying partnerships that do not exist.

The request card gained tabs, a `POST` method chip, labelled Request and
Response blocks and a meta footer. **Deliberately omitted:** the reference's
`156 MS · 29 TOKENS · COST $0.00087`. Those are measurements; inventing them
would misrepresent performance. The meta bar carries `STREAM · SSE` and the API
base instead. Tabs are limited to the two shapes actually relayed rather than
the reference's four vendor tabs.

### Metrics band

The existing `Stats` component was unused and carried `50+ / 100+ / 50+ / 10+`
copied from the reference — claims this deployment cannot substantiate. It is
now wired into the page and every figure is derived from the live catalogue:
published models, distinct providers, models with a live route, and the two
compatible request formats. On the development dataset it reads `2 / 1 / 2 / 2`.
That is less impressive and correct.

### Model catalogue — the main structural change

Centred masthead and search; a sticky facet sidebar; a results toolbar with
count and sort; a responsive grid; pagination at 12 per page.

Five real dimensions, all derived from fields the API already returns:

| Facet        | Source                                                        |
| ------------ | ------------------------------------------------------------- |
| Category     | `category`                                                    |
| Provider     | `provider_label`                                              |
| Capability   | `capabilities[]`                                              |
| Pricing type | `pricing.quota_type` → per-token / per-request / **unpriced** |
| Status       | `availability_status`                                         |

Nothing was invented. "Unpriced" is a real catalogue state and stays visible
rather than being folded into per-token, which would imply a rate that does not
exist.

`facetCounts` counts each facet against the models passing _every other_
filter. Counting against the filtered list makes every unselected option read 0
as soon as one filter is applied; counting against the unfiltered list
overstates what a click returns. Excluding only the facet's own dimension gives
the number the user is actually asking for. Covered by a test.

### About

Replaced the construction notice with a real page: what the gateway does,
neutral aliases, auditable usage. No company history, headcount, customer count
or SLA — none of that is knowable here. The AGPL attribution block is preserved
verbatim.

### i18n

33 new keys added to `en` and `zhCN`. Appended rather than re-sorted: the
locale files are in insertion order, and sorting would have rewritten several
thousand lines for a 33-key change.

## Bug found and fixed on the way

`listPlatformModels` returned `response.data.data` verbatim. A successful
envelope with a `null` payload therefore reached consumers as `null`, and
`const { data = [] } = useQuery(...)` does **not** default on null — only on
`undefined`. Adding the catalogue query to the home page surfaced this: the
runtime E2E fixture answers unmatched routes with `{ success: true, data: null }`,
`.map` threw, and the whole home page — footer included — failed to render.
Normalised at the API boundary with `?? []`, which protects every call site.

## Honest limits

- **Rankings** already matched the reference structurally (time tabs, chart card
  with right-aligned total, leaderboard list, market share, vendor ranking,
  trend cards). The visible difference is data volume: the reference shows 92
  models over a year, this environment has 2 models over 2 days. That is a data
  limitation, not a layout one, so the page was left alone.
- **Metrics read small** (`2 / 1 / 2 / 2`) because the development catalogue is
  small. Correct beats impressive.
- **Facet values** such as `general`, `chat`, `streaming` render as raw API
  identifiers rather than translated labels. They are data values, not UI
  strings; translating them needs backend display metadata.
- Vendor colours in the market-share chart were left as vendor brand colours,
  which is what the reference does too.
- Pricing page kept its provisional banner and semantics unchanged.

## Verification

| Command                     | Result                                |
| --------------------------- | ------------------------------------- |
| `bun run format:check`      | pass                                  |
| `bun run typecheck`         | pass                                  |
| `bun run test`              | 118/118                               |
| `bun run build`             | pass                                  |
| `bunx playwright test`      | **125/125**                           |
| `scripts/lint-guard.ps1`    | pass, baseline unchanged at 447       |
| `go build ./...`            | pass (confirms `//go:embed web/dist`) |
| dev + prod `compose config` | pass                                  |
| `scripts/dev-health.ps1`    | all green                             |

Two pre-existing E2E assertions were updated because the UI contract changed,
not to make them pass: the catalogue "all N cards render" assertion became a
page-size + pagination contract (including that Next actually changes the
rendered page).

Browser matrix captured at 390 / 768 / 1440, light and dark, `zhCN` and `en`.
No horizontal overflow at any combination. Evidence and a capture log are in
`artifacts/phase-ui-seekgt/`.
