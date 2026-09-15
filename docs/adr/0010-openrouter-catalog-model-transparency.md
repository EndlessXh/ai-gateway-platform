# ADR 0010 — OpenRouter catalog models: real identity, hidden transport

**Status:** Accepted
**Date:** 2026-09-11

## Context

ADR 0009 validated exactly one OpenRouter route (`claude-opus-4.6`) and chose
to hide both the upstream vendor and the fact that OpenRouter was involved,
branding the result as a platform-owned model (`provider_key=platform`,
`provider_label=HYC AI`). That was accepted for a single, narrow
"private upstream" use case.

The product is now importing OpenRouter's broader catalog as browsable,
callable platform models (see `docs/adr/0007` for the catalog architecture).
Applying 0009's identity-hiding to this broader set would put the codebase in
conflict with ADR 0003, which already established the platform's baseline
rule: never claim a vendor is serving a model unless it genuinely is, and
"the day [a vendor] is genuinely connected, a `claude-*`-branded offering can
be introduced truthfully." For OpenRouter-routed catalog models, the named
vendor genuinely is serving the request — Anthropic, OpenAI, Google, etc. are
real, not a placeholder standing in for an unconnected vendor the way Bailian
was in ADR 0003's original context.

## Decision

For models entering `platform_model_catalog` through the OpenRouter sync
(scope: everything except the ADR 0009 `claude-opus-4.6` /
`provider-spike` route, which keeps its existing configuration unchanged):

- **The user-facing model identity is the real one.** `public_model_id` is
  derived from OpenRouter's own `id` (vendor prefix stripped), `display_name`
  from OpenRouter's own `name`, `provider_key`/`provider_label` from the real
  vendor. A model billed as Anthropic's Claude is presented as Anthropic's
  Claude.
- **What a user selects is what actually runs.** No display-name-to-different-
  real-model substitution (no "shows 4.7, serves 4.6"). `ModelMapping`'s only
  job stays translating the platform's clean alias to OpenRouter's
  vendor-prefixed upstream id for the exact same model — a naming
  transformation, not a model substitution.
- **The transport layer stays private.** That the request is routed through
  OpenRouter, and OpenRouter's own upstream routing/headers/generation IDs,
  remain hidden from the user-facing protocol surfaces and non-admin logs —
  this is unchanged from ADR 0009 and is not a transparency question. A
  reseller not disclosing its upstream distributor is ordinary and is not in
  tension with disclosing whose product is being resold.
- **Markup is disclosed, not hidden inside an opaque model_ratio.**
  `model_ratio` reflects OpenRouter's real per-token cost; any margin is
  applied through the existing `GroupRatio` mechanism
  (`setting/ratio_setting/group_ratio.go`), which is already visible
  platform-wide pricing structure, not something invented for OpenRouter.
- **ADR 0009's route is unaffected.** `claude-opus-4.6` /
  `provider-spike` keeps `provider_key=platform` / `provider_label=HYC AI`
  exactly as shipped. This ADR governs new catalog entries created by the
  OpenRouter sync going forward; it does not retroactively rewrite 0009's
  existing row.

## Consequences

- `provider_key` on `PlatformModelCatalog` now carries two different meanings
  depending on how a row originated: `platform` for platform-branded routes
  (ADR 0009-style, still valid for that narrow use case) and a real vendor
  slug (`openai`, `anthropic`, `google`, ...) for catalog-imported models.
  Both are legitimate; a reader must not assume `provider_key=platform` is
  the only valid value.
- The public model catalog and `/api/pricing` now disclose real vendor
  identity for these models. `icon_key` continues to select the existing
  generic capability icon set (Option B, unaffected: no icon_key whitelist
  expansion); `provider_key` is the separate signal a frontend uses to look
  up a vendor-brand icon.
- `ModelMapping`'s scope is now explicit: alias-to-real-upstream-id
  translation for the *same* model only. Any future request to use it for
  "show X, serve Y" model substitution is a new, separately-scoped product
  decision, not something this sync or this ADR authorizes.
- OpenRouter-as-transport-layer secrecy (headers, generation IDs, routing
  diagnostics, non-admin log fields) is carried over from ADR 0009 unchanged
  and continues to be enforced by the existing
  `relay/channel/openai/openrouter_security_test.go` suite.

## Rejected alternatives

- **Keep 0009's model applied to all OpenRouter models.** Rejected: puts the
  codebase in direct conflict with ADR 0003's "truth in naming" principle for
  models where the real vendor is demonstrably serving the request.
- **Hide vendor identity but disclose OpenRouter as the transport.** Rejected:
  backwards from the actual privacy/business concern — customers care who
  makes the model they're buying, not which routing intermediary the platform
  uses to reach it.
