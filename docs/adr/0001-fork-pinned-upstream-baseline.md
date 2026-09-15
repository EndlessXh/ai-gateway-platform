# ADR 0001 — Fork New API at a pinned commit

- Status: Accepted
- Date: 2026-07-28

## Context

The product needs a commercial-grade AI gateway: relay to multiple providers,
channels, billing, tokens, users, permissions, logging, and an admin console.
Building that from scratch is many months of work, and the billing and relay
paths are the parts most expensive to get wrong.

New API already implements all of it, and the existing `new-api-infra` stack
proves it runs correctly in this environment.

Upstream tags releases as `v1.0.0-rc.N`. That spelling suggests a pre-release,
which conflicts with a requirement to use "the latest non-prerelease stable
version". Resolved empirically: GitHub's `/releases/latest` endpoint excludes
pre-releases and drafts by definition, and on 2026-07-28 it returned
`v1.0.0-rc.22` with `prerelease: false`. The `rc` suffix is cosmetic; the `rc`
line is upstream's current release line and the `v0.9.x` line is simply older.

## Decision

Fork New API at **`v1.0.0-rc.22`**, commit
`bc14c18f6024e79cba1c08d02cd007796e12d668` (annotated tag object
`942c1bb2593f3bac71ea9c84425afa3107a6cd5a`).

- New repository at `ai-gateway-platform`, independent of `new-api-infra`.
- `upstream` remote configured; no local branch tracks it.
- Branches `product/main` and `product/develop`.
- Immutable marker tag `upstream-baseline/v1.0.0-rc.22`.
- Modular monolith. No microservices.
- Keep the Go/Gin/GORM backend and the React 19 + TypeScript frontend. No
  second frontend stack, no Vue portal.

## Consequences

**Good.** Complete gateway on day one. The reference product (seekgt.com) runs
rc.15, so we start seven releases ahead of it (see `docs/reference-audit.md`).
Upstream fixes remain importable.

**Cost.** We inherit upstream's architecture and its AGPL obligations
(ADR 0002). Every in-place modification to an upstream file becomes a permanent
merge cost, so product code is kept in additive paths and the modified-file
list in `docs/upstream-sync.md` is deliberately kept short.

**Rejected — track `main` or `latest`.** Reproducibility is impossible when the
base moves, and a bad upstream commit would land straight in production.

**Rejected — start from `v0.9.28`.** It only looks like the "stable" line
because of the `rc` naming. It is older and would mean forgoing seven releases
of fixes.
