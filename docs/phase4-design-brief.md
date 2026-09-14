# Phase 4 design brief

Constraints only. No page code, no component APIs — those are Phase 4's to
write. This document exists so the design decisions are made deliberately
rather than defaulting to whatever the framework ships.

## What this product is

Infrastructure that developers route production traffic through, and pay for by
the token. Two things follow from that:

- **The audience is technical.** They read tables, compare numbers, and copy
  code. They are not persuaded by adjectives.
- **The product handles their money.** Anything that looks careless implies the
  billing is careless.

## Character

**precise · infrastructural · calm · technical · trustworthy · editorial ·
premium but restrained**

Read as design decisions:

| Quality | Means |
|---|---|
| precise | Exact numbers, aligned columns, consistent units. Never "fast" — say the latency. |
| infrastructural | Looks like something that stays running. Structural, not decorative. |
| calm | Nothing competes for attention. One primary action per view. |
| technical | Monospace for identifiers, tokens, prices, code. Real data in examples, not lorem ipsum. |
| trustworthy | Errors are specific and actionable. Costs are shown before they are incurred. Nothing important is hidden behind a hover. |
| editorial | Deliberate typographic hierarchy and measured line length. Content leads, chrome recedes. |
| premium but restrained | Quality shown through spacing, alignment and typography — never through ornament. |

The reference site (`docs/reference-audit.md`) is stock upstream with a changed
site name. Matching it is not the bar; it is the floor.

## Spacing

**8px base.** 4px permitted only for optical adjustment inside a component
(icon-to-label, badge padding).

Scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`

Spacing carries meaning: related things sit closer than unrelated things. If
two elements are the same distance apart as two unrelated ones, the layout is
saying nothing.

## Colour

**Semantic tokens only.** No raw hex in components, no `text-blue-500`. If a
component names a colour rather than a role, the token set is incomplete.

Required roles:

- surface: page, raised, sunken, overlay
- content: primary, secondary, tertiary, disabled, inverse
- border: subtle, default, strong, focus
- brand: primary, hover, active, subtle
- status: success, warning, danger, info — each with foreground, background,
  border

Rules:

- Status colour is never the only signal. Pair with icon and text —
  colour-blind users and greyscale printouts both need to work.
- Danger is reserved for destructive and failed states. Not for emphasis.
- Charts need their own categorical ramp, distinguishable in greyscale.

## Typography

One type scale, applied consistently. Distinguish levels by **size and weight**,
not colour alone.

- Display / H1 / H2 / H3 / body-lg / body / body-sm / caption / mono
- Monospace for: API keys, model identifiers, prices, code, log lines, request
  IDs
- Body line length 60–80 characters. Tables may exceed it; prose may not.
- Minimum body size 14px; 16px preferred for reading.
- Tabular numerals for anything in a column that gets compared — prices, token
  counts, quotas. Proportional digits make columns lie.

## Light and dark

Both are first-class. Dark is not an inverted light theme.

- Every semantic token has a value in both.
- Contrast is verified in both, not assumed.
- In dark mode, elevation reads through surface lightness, not heavier shadow.
- Respect system preference by default; honour an explicit user choice.
- No flash of wrong theme on load.

`next-themes` and `web/src/context/theme-provider.tsx` already exist. Use them.

## Responsive

Viewports to verify: **320 · 768 · 1024 · 1440 · 1920**.

- 320px must work. It is the floor, not an afterthought.
- Tables reflow to cards on narrow screens —
  `web/src/components/data-table/**` already implements this pattern; reuse it.
- Touch targets ≥ 44×44px.
- Navigation collapses to a drawer on mobile; the drawer traps focus and closes
  on Escape.
- No horizontal scroll at any listed width, except deliberately scrollable
  table regions.

## Accessibility

Not a later pass.

- WCAG 2.1 AA contrast: 4.5:1 body text, 3:1 large text and UI boundaries.
- Every interactive element reachable and operable by keyboard.
- **Visible focus on every focusable element.** Never remove an outline without
  replacing it with something at least as visible. `:focus-visible`, so mouse
  users are not distracted.
- Logical focus order; skip link to main content.
- Semantic HTML first. A `<div>` with a click handler is a bug.
- Form fields have real `<label>`s. Errors are associated via
  `aria-describedby` and announced.
- Icon-only buttons carry accessible names.
- All user-facing text through i18next — no hardcoded strings.

## Motion

Motion communicates state change and hierarchy. It does not decorate.

- Duration 120–240ms for UI feedback; up to 320ms for larger transitions.
- Ease-out entering, ease-in exiting.
- Animate `transform` and `opacity`. Animating layout properties causes jank.
- **`prefers-reduced-motion: reduce` must be honoured** — remove transforms and
  parallax, keep opacity changes under 100ms, disable autoplay. Not a
  degraded experience; an equally complete one.
- Nothing loops or moves without user intent.
- Loading states: skeletons that match final layout, so content does not jump.

## Explicitly forbidden

Unless the existing design system already does it, or there is a written reason:

- purple/blue "AI startup" gradients
- neon, glow, saturated accents on dark backgrounds
- stacked glassmorphism / heavy backdrop blur
- more than one elevation shadow layer per surface
- decorative 3D, particles, animated mesh backgrounds
- centred symmetrical SaaS template layouts with three equal feature cards
- pure `#fff` on `#000`
- marketing superlatives in UI copy ("blazing fast", "revolutionary")
- new large dependencies (Framer Motion, GSAP, Three.js) — CSS first, then
  what is already installed, then ask

## Information architecture

Borrow structure and interaction patterns from the reference and from
established gateway products. Do **not** copy their brand assets, logo,
illustrations, or verbatim marketing copy — and do not copy their prices
(ADR 0006: prices come from `GET /api/pricing`).

Public pages answer, in order: what it is → what it costs → how to start.
Pricing must be reachable without an account and legible without one.

Console pages answer: what am I spending → what are my keys → what happened →
how do I fix it.

Admin optimises for **density and diagnosis**. More rows per screen, more
detail per row. Do not trade an operator's efficiency for visual calm; an
admin debugging a failing channel at 2am needs information, not whitespace.

## Non-negotiable

- **Footer and `/about` carry the AGPL attribution and source link.** Values
  are constants in `setting/platform/compliance.go`; brand config cannot blank
  them. See `docs/legal-and-source-offer.md`.
- **All brand strings resolve from one config module.** Working name
  **HYC AI** is provisional. If renaming touches more than that module, the
  design is wrong.
- **Prices come from `GET /api/pricing`.** No second price list.
- **No new lint debt** — `pwsh ./scripts/lint-guard.ps1` is blocking in CI.

## Verifiable vs not

Verify with tools, and do: DOM structure, computed CSS, contrast ratios,
breakpoint behaviour, focus order, accessibility tree, keyboard traversal,
`bun run typecheck`, `lint-guard.ps1`, bundle size, runtime errors.

Cannot be verified by an agent without real visual input: whether it looks
good, whether it feels premium, brand fit, pixel fidelity to a mock. Those need
a human or a genuine visual-capable reviewer. Do not claim them.
