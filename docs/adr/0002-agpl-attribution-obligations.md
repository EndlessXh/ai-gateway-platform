# ADR 0002 — AGPL-3.0 obligations and the brand boundary

- Status: Accepted
- Date: 2026-07-28

## Context

The product brief calls for an independent brand system with no hardcoded
names, and for matching a reference site's product quality without copying its
trademarks or assets. Read carelessly, "independent brand" could be taken as
licence to strip every trace of the upstream project. It is not.

New API is **AGPL-3.0**, plus **additional terms under AGPLv3 Section 7(b)**
recorded in `NOTICE`. Verbatim:

> the following reasonable legal notice and author attribution must be
> preserved by modified versions in the Appropriate Legal Notices and in any
> prominent about, legal, footer, or attribution location presented by the
> user interface:
>
> "Frontend design and development by New API contributors."
>
> Modified versions that present a user interface must also preserve a visible
> link to the original project in a prominent about, legal, footer, or
> attribution location:
>
> https://github.com/QuantumNous/new-api
>
> Modified versions must not misrepresent the origin of the software and must
> mark their changes in accordance with AGPLv3 Section 7(c).

Upstream's `AGENTS.md` independently protects references to the project and
organisation identity across README files, licence headers, package metadata,
module paths, import paths and Docker image names.

Two further AGPL consequences are easy to overlook:

- **§13 network use.** Operating this as a hosted service triggers the
  obligation to offer users the Corresponding Source of our modified version.
  It is not a private fork just because we never ship a binary.
- **Copyleft scope.** Product code linked into this program is part of the
  combined work and inherits AGPL terms.

## Decision

Treat attribution as a **hard, non-configurable constraint**, and brand as an
additive layer on top of it.

1. `LICENSE`, `NOTICE` and `THIRD-PARTY-LICENSES.md` are never modified,
   relocated, or excluded from any build, image, or bundle we distribute.
2. The required attribution string and the link to
   `https://github.com/QuantumNous/new-api` appear in a prominent, permanent
   location in the UI — the footer and `/about`. They are **not** routed
   through the brand configuration and must not be renderable as empty.
   Brand config controls product name, logo and marketing copy; it has no
   switch that can suppress attribution.
3. Go module path, package names, import paths and upstream Docker image
   references stay as they are. Renaming buys nothing and would create a
   repo-wide permanent merge conflict.
4. Changes are marked per §7(c): `docs/upstream-sync.md` keeps an exhaustive
   list of modified upstream files, and product code is confined to additive
   paths.
5. Before any public launch, a source-offer mechanism must exist to satisfy
   §13. **This is an open obligation, not something completed in this phase.**

## Consequences

**Good.** Compliance is designed in rather than retrofitted under pressure. The
brand layer has a clear boundary: it owns product identity, not legal notices.

**Cost.** The footer is not fully free design space — it must carry attribution
and a working outbound link, which constrains Phase 4 layout. AGPL also
constrains any future decision to keep product code proprietary; if that is
ever wanted, it requires a different base, not a licence reinterpretation.

**Rejected — remove or rename upstream identifiers.** Violates both the licence
and upstream's stated policy.

**Rejected — put attribution behind brand config.** A brand switch that can
blank the notice is a licence violation waiting for a misconfiguration.
