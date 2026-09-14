# Final visual evidence — per-page audit

Commit `00dd6cf5c7a84af3eca076a6f9cbf7e06a6a7273`, branch `product/main`,
working tree clean. Captured against `http://127.0.0.1:4173` (`bun run dev`)
with the API on `http://127.0.0.1:3001`. **No code was changed in this round.**

## Reference availability — read this first

**The SeekGT reference screenshots were not available to this session.** They
are not stored anywhere in the repository, not in the scratchpad, and not in
the current context (the session was compacted and images do not survive
compaction).

Consequently:

- Every statement about **our** pages below is grounded in the 26 screenshots
  in this directory and in DOM measurements taken from the running product.
  Those are first-hand.
- Every statement about **the reference** is second-hand, taken from the
  written description recorded in `docs/phase-ui-seekgt-alignment.md` when an
  earlier session did have the images. It is labelled `[ref: documented]`.
- **No pixel comparison was performed, and none is claimed.** Where a
  judgement genuinely requires seeing the reference image, it is marked
  `NEEDS REFERENCE` rather than guessed.

Categories: **A** brand difference (acceptable) · **B** real data volume ·
**C** product capability difference · **D** CSS/layout still to fix ·
**E** functional defect.

---

## `/` — Home

| Aspect | Observed (first-hand) | Cat |
| --- | --- | --- |
| Overall silhouette | Hero → metrics band → capability panels → supporting row → protocols → 3 steps → CTA → footer. Section order is stable across 1440/1920/768/390. | — |
| Header height/density | 48px bar, logo + 7 nav items + 4 icon controls + near-black 登录 button. Compact and consistent on every route. | — |
| Hero proportion | Left copy column ≈ 45%, right request card ≈ 45% at 1440. Headline 2 lines both locales. | — |
| Headline size | 42px at 1440, 44px at 1920 (measured). | NEEDS REFERENCE |
| **Section headings wrap mid-compound at 1920** | Measured: "为开发者打造，全程可观测" is 44px in a **fixed 502px** column → **2 lines**, breaking between 打 and 造. "两种请求格式，一个统一管控的网关" the same in a 678px column. At 1440 both are 1 line. Cause: `type-section-title` grows with `vw` but its grid column does not. | **D** |
| Background gradient | Blue-cyan wash top, blue/violet wash behind the closing CTA. Bookends the page. No green. | — |
| Primary CTA | Near-black fill, white label. Confirmed in both themes (near-white in dark). | — |
| API example card | Tabs (OpenAI 兼容 / Messages 兼容), method chip, request+response blocks, meta footer. | — |
| Section spacing | `section-block` resolves to 120px top **and** bottom at 1920 → ~240px between sections. Contributes materially to the page reading sparse at that width. | **D** |
| Capability panels | Four asymmetric panels (7/5, 5/7) with internal content, plus a 4-icon supporting row. Not four identical cards — but the weight difference between the wide and narrow panels is small at 1920. | **D** (minor) |
| Three-step row | Present with numbered circular icons and a connector. Icons are visually light relative to the 240px of surrounding whitespace; the block reads small at 1920. | **D** |
| Metrics band | 2 / 1 / 2 / 2 at `text-6xl` with column rules. Values are real and derived. | **B** |
| Footer | Brand blurb, 5 links, © line, "基于 New API · AGPL-3.0", §7(b) notice. | — |

## `/model-catalog` — 模型广场

| Aspect | Observed | Cat |
| --- | --- | --- |
| Masthead | Centred, eyebrow + `模型广场` + lede + centred search. | — |
| Filter sidebar | Five real facets with counts; labels translated (通用 / 平台路由 / 对话). | — |
| **Result grid fill** | Measured `486px 486px`, cards span **992 / 992 available = 100%**, 0px empty right, at *both* 1440 and 1920. The round-4 sparse-grid fix works. | — |
| Card density | Model id, display name, provider, description, capabilities, modalities, status, price, copy, details. | — |
| Page length | 1315px at 1440 — footer arrives early because there are two models. | **B** |
| Context length row | Absent; `context_label` is empty by design. | **C** |

## `/leaderboard`

| Aspect | Observed | Cat |
| --- | --- | --- |
| **Direct entry** | Opens correctly. `h1 = 排行榜`, HTTP 200, at 1440/1920/768. Not a 404. | — |
| **Masthead inconsistency** | Left-aligned, and uses a bespoke `clamp(1.75rem,4vw,2.5rem)` instead of the shared `type-page-title` used by `/pricing` and `/model-catalog` — which are also **centred**. Three catalogue-class pages, two different masthead treatments. | **D** |
| Period tabs | 今天 / 本周 / 本月 / 今年 present and wired to the `period` search param. | — |
| Main chart | Structure correct (title, lede, right-aligned 720 TOKEN total). | — |
| **Bar rendering with 2 points** | Two data points render as two solid slabs each ≈30% of the chart width. No max bar width, so low cardinality produces blocks rather than bars. The *data* being small is category B; rendering it as slabs is a layout choice. | **D** |
| Vendor label | Shows literal `Unknown` / `by unknown` because the vendor is genuinely unattributed. Honest, but reads as a defect. | **B** |
| Empty states | 上升趋势 / 下降趋势 both render a proper "当前没有明显上升/下降的模型" empty state rather than a blank card. | — |

## `/pricing`

| Aspect | Observed | Cat |
| --- | --- | --- |
| Masthead | Centred, matches `/model-catalog`. | — |
| Provisional banner | Present, full width, amber. | — |
| Toolbar | Filter count, view toggles, token unit, sort, layout toggles — dense and aligned. | — |
| **Result grid fill** | Measured `416px 416px 416px` — a **three-column grid holding two cards**. Cards span 848 of 1280 available → **432px (34%) empty on the right**, identical at 1440 and 1920. This is the same defect fixed on `/model-catalog` in round 4 and **missed on this page**. | **D** |
| Card content | Input/output price, description, group, billing mode, endpoint, status. Real rates from the pricing API. | — |
| Footer proximity | Page is 1114px tall; footer follows the two cards closely. | **B** |

## `/sign-in` and `/sign-up`

| Aspect | Observed | Cat |
| --- | --- | --- |
| Auth logic | Password form, 忘记密码, 注册 link, password visibility toggle all present. No capability removed. | — |
| Primary button | Near-black, full width. | — |
| Split at 1440 | Left narrative (`Gateway access` + statement + 3 feature rows), right form card. Proportion reasonable. | — |
| **768 × 1024 is badly empty** | Measured: `aside` is `display:none` (it is `lg:flex`, and 768 < 1024). Card is 342px tall inside a 960px main → **fill ratio 36%, with 309px empty above and 309px below**. Roughly two-thirds of the viewport is bare background. | **D** |
| 1920 | Page height grows to 1378px; the narrative column returns. | — |
| 390 | Form-first, card fills the width, no overflow. | — |
| Shell sharing | `/sign-up` reuses the same `AuthLayout`; no duplicated styling. | — |

## `/about`

| Aspect | Observed | Cat |
| --- | --- | --- |
| **Masthead alignment** | **Left**-aligned, while `/pricing` and `/model-catalog` are centred. Inconsistent. | **D** |
| Content | Three capability cards + attribution block. Truthful; no invented team, customers or SLA. | — |
| Attribution | New API name, repo link, AGPL-3.0 and the §7(b) notice all present. | — |
| Density | 1209px tall; reads as a thin description page rather than a product story. The attribution block is a bordered panel that still reads a little like a system notice. | **D** (minor) |

## `/404-test-route`

Renders the 404 page (`网关中不存在此页面。`) with header and footer intact, at
both desktop widths. Correct behaviour — a genuinely unknown path should 404.

---

## Category totals

| Cat | Count | Items |
| --- | --- | --- |
| A — brand | 1 | Green retained for logo/success only; page surface is white |
| B — real data volume | 5 | 2 models (catalogue, pricing), 2 days / 720 tokens, `Unknown` vendor, short pages |
| C — capability | 2 | `context_label` empty; two request protocols rather than a vendor matrix |
| **D — still to fix** | **8** | 1920 heading wrap · pricing 3-col grid with 2 cards · sign-in 768 emptiness · leaderboard masthead inconsistency · leaderboard slab bars · about masthead alignment · 1920 section rhythm · panel/step weight at 1920 |
| **E — functional** | **0** | All 8 routes HTTP 200 with correct `h1`, no overflow at any of 7 widths, no devtools, no stray floating widgets |

## The ten explicit judgements

1. **Sparse at 1440/1920?** 1440 reads acceptably. **1920 does still read sparse** — 240px between sections, and two section headings wrap mid-word. Real, and fixable.
2. **Hero impact vs reference?** `NEEDS REFERENCE`. Measured 42→44px with a two-line headline and a balanced two-column split; whether that matches the reference's impact cannot be asserted without the image.
3. **Capability panels still four plain cards?** No — they are asymmetric (7/5, 5/7) with distinct internal content. But at 1920 the weight difference between wide and narrow panels is small. Partly addressed.
4. **Three-step row still small?** **Yes.** It scaled with the type tokens but was not redesigned; the icons stay light against ~240px of surrounding space.
5. **Unacceptable whitespace on the catalogue with 2 models?** **No.** Measured 100% row fill, 0px empty right, at both widths.
6. **Pricing unbalanced with 2 models?** **Yes.** Three-column grid holding two cards → 34% of the row empty. Same class of bug as (5), missed on this page.
7. **`/leaderboard` real page or 404?** **Real page.** `h1 = 排行榜`, HTTP 200, at 1440/1920/768, on direct entry.
8. **Sign-in obviously empty at 768×1024?** **Yes, clearly.** 36% fill, 309px dead space above and below, narrative column hidden because its breakpoint is `lg`.
9. **Footer natural, with New API and AGPL intact?** **Yes.** One upstream link, licence link, §7(b) notice; no duplication; wraps sanely at 390.
10. **Still a "green admin template"?** **No longer green** — the surface is white (`oklch(1 0 0)`), primary is near-black, the wash is blue/violet, and green survives only in the logo. Whether it now reads as *commercial SaaS* is a separate question, and the honest answer is **not yet** — the remaining obstacle is the density and consistency issues in category D plus genuinely thin data, not colour.

## Recommendation

**Do not close the UI alignment phase yet.** There are zero functional defects
and the colour and routing corrections hold up under measurement, but eight
category-D layout issues remain, three of which are measured and specific
(1920 heading wrap, pricing grid fill, sign-in at 768). Those are a focused
half-round of work, not another broad pass.

Separately, closing the phase properly still requires a human to compare these
screenshots against the SeekGT reference images, because this session could not.
