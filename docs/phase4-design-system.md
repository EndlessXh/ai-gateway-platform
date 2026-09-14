# Phase 4 design system

Implemented 2026-07-28. This document records the product-owned visual layer
introduced in Phase 4; it does not change relay, quota, billing, channel, or
model behaviour.

## Product direction

HYC AI uses a restrained editorial system for an infrastructure product:
neutral surfaces, a deep green accent, large display typography on public
pages, and denser functional layouts in the authenticated console. Capability
claims are limited to behaviour exercised by the development stack. Extensible
architecture is described separately from currently configured availability.

## Source files

| Concern | Source of truth |
|---|---|
| Product name, logo, metadata and product links | `web/src/config/brand.ts` |
| Immutable upstream attribution fallback | `complianceFallback` in `brand.ts` |
| Runtime compliance and pricing status | `GET /api/status` via `use-compliance.ts` |
| Semantic colour, radius, shadow and motion tokens | `web/src/styles/theme.css` |
| Container and type utilities | `web/src/styles/index.css` |
| Product mark | `web/public/hyc-mark.svg` |

Attribution is deliberately separate from editable brand values. The backend
returns constants from `setting/platform/compliance.go`; the frontend fallback
cannot be blanked by site configuration. This preserves ADR 0002.

Runtime product naming resolves in this order: a non-empty administrator
`SystemName` override, `PLATFORM_BRAND_NAME`, then the safe `HYC AI` fallback.
The upstream defaults `New API` / `NewAPI` are treated only as unset product
branding, while the immutable compliance record continues to render New API
attribution and its repository link. `scripts/dev-seed-brand.ps1` applies the
same product name to the development database repeatably.

## Tokens

### Colour

- `background` / `foreground`: primary canvas and text.
- `card`, `popover`, `surface-elevated`: raised functional surfaces.
- `muted`, `surface-subtle`: secondary regions and low-emphasis structure.
- `primary`: deep evergreen in light mode and a lighter accessible green in
  dark mode.
- `border`, `input`, `ring`: quiet boundaries and consistent focus treatment.
- `destructive`, `surface-danger`: destructive actions and error recovery.
- Chart and sidebar tokens remain mapped to the upstream components so data
  visualisations and the console do not fork a second palette.

The light canvas is a low-chroma off-white; dark mode is near-black green.
Status colours remain semantic and are not used as decorative brand colours.

### Typography

- Interface copy uses the existing Public Sans variable font.
- Display headings use the same family at a heavier weight and tighter tracking
  to avoid adding a new font payload.
- Monospace values and request examples use the existing mono stack.
- Shared utilities: `type-display`, `type-page-title`, `type-section-title`,
  `type-label`, and `data-value`.

### Geometry and depth

- Base radius: `0.75rem`; compact controls remain proportionally smaller.
- Depth uses borders first and soft shadows second. Public cards use one quiet
  raised level; console tables keep flatter boundaries for scanability.
- Content uses `page-container` and `reading-width` rather than route-specific
  arbitrary widths.

### Motion

- Fast and standard timing tokens use restrained easing.
- Header compaction, mobile navigation, tabs and hover feedback use short
  transitions only.
- `prefers-reduced-motion` disables non-essential animation and smooth scroll.

## Layout patterns

- Public shell: fixed responsive header, skip link, `#content` landmark,
  page content, and mandatory footer.
- Auth shell: editorial context panel on wide screens, focused form card on the
  right, compact brand header and the same compliance footer.
- Console shell: sidebar, persistent header, current-section context, content
  surface and responsive data layouts inherited from the existing table system.
- Error pages: oversized status code plus a clear recovery hierarchy (retry,
  dashboard/sign-in, home, documentation).

## Responsive and accessibility rules

- Verified viewports: 390×844, 768×1024 and 1440×900.
- Mobile header controls and navigation actions have at least 44×44 px targets.
- The mobile navigation traps Tab focus, closes on Escape, restores focus to
  its trigger, and locks body scrolling while open.
- Keyboard focus uses the semantic ring token and the public shell exposes a
  skip link to `#content`.
- Both themes retain visible borders, status surfaces and text hierarchy.
- All Phase 4 user-facing copy passes through i18next; untranslated locales
  use the English source string until product translations are approved.

## Data and truthfulness constraints

- Pricing presentation consumes the existing `GET /api/pricing` hook only.
- The provisional pricing banner is driven by `pricing_status` from
  `GET /api/status`.
- Source-code availability is driven by `compliance.source_code_url`; an empty
  value is displayed as pending configuration, never replaced with a fake URL.
- Marketing copy does not claim unconfigured providers, unverified model
  capabilities, uptime, latency or commercial readiness.
