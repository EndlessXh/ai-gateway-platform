# AI Gateway Platform

A commercially operable AI model gateway: multi-provider relay behind one API,
with users, API tokens, quota and billing, usage logs, and an admin console.

Built as a **pinned fork of [New API](https://github.com/QuantumNous/new-api)**
at `v1.0.0-rc.22` (commit `bc14c18f6024e79cba1c08d02cd007796e12d668`).
The original project README is preserved verbatim at
[`README.upstream.md`](./README.upstream.md).

> **Attribution.** Frontend design and development by New API contributors.
> Original project: https://github.com/QuantumNous/new-api
>
> This is a modified version, licensed under the GNU AGPL v3.0. See `LICENSE`,
> and `NOTICE` for additional terms under AGPLv3 §7. These notices are a
> licence obligation, not branding — see
> [`docs/adr/0002-agpl-attribution-obligations.md`](./docs/adr/0002-agpl-attribution-obligations.md).

## Status

Phases 0–4, Phases 5A–5B and Phase 6A/6A.1/6A.2 complete: upstream baseline pinned, isolated environment running,
full relay chain verified against live services, and the HYC AI design-system,
brand, public/auth/console shells, pricing presentation and compliance footer
implemented. Phase 5A adds an API-backed product model catalog, live pricing
metadata aggregation, administrator diagnostics and a minimal Playground data
hook. See [`docs/phase5a-model-catalog.md`](./docs/phase5a-model-catalog.md).
Phase 5B productizes the existing Wallet ledger, Profile editing and
user-owned Session security without introducing a duplicate balance or payment
system. See [`docs/phase5b-wallet-profile.md`](./docs/phase5b-wallet-profile.md).
Production remains gated by the documented source, pricing and nginx
verification blockers.

Phase 6A validates OpenRouter as the single private upstream for the public
`claude-opus-4.6` alias across Chat, Anthropic Messages and the non-core
Responses Beta surface. See
[`docs/phase6a-openrouter-validation.md`](./docs/phase6a-openrouter-validation.md)
and [`docs/openrouter-channel.md`](./docs/openrouter-channel.md).
Phase 6A.1 makes the default relay regression local and zero-cost, repairs the
Claude Code executable path, and records bounded client and production-release
evidence. Phase 6A.2 fixes the Claude Messages metadata validation failure and
verifies the official native CLI through HYC and OpenRouter. Production and
Phase 6B remain unstarted; see
[`docs/openrouter-release-readiness.md`](./docs/openrouter-release-readiness.md).

The historical 2026-07-28 live smoke evidence is retained below, but the same
script now runs a deterministic loopback upstream and consumes no Provider or
customer quota:

```
[ OK ] admin login                    JWT issued
[ OK ] token created                  model-limited, quota-bounded, expiring
[ OK ] non-streaming relay            2.1s, tokens=20, reply='SMOKE_OK'
[ OK ] streaming relay (SSE)          content-type=text/event-stream, chunks=6, first-chunk=2ms, [DONE]=True
[ OK ] consumption logs               2 entries
[ OK ] quota decremented              used_quota=106 (was 0), remain=499894
[ OK ] wallet ledger updated          quota decreased, used quota increased, requests +2
[ OK ] rejected request unbilled      HTTP 403, Wallet ledger unchanged
```

## Stack

| Layer           | Technology                                                     |
| --------------- | -------------------------------------------------------------- |
| Backend         | Go 1.25, Gin, GORM                                             |
| Frontend        | React 19, TypeScript, Rsbuild, TanStack Router, Tailwind CSS 4 |
| Database        | PostgreSQL 16                                                  |
| Cache           | Redis 7                                                        |
| Orchestration   | Docker Compose                                                 |
| Production edge | nginx (TLS, SSE, rate limiting, security headers)              |
| Scripting       | PowerShell 7                                                   |

## Prerequisites

- Docker Desktop, engine running
- Go 1.25+
- [Bun](https://bun.sh) — `irm bun.sh/install.ps1 | iex`
- PowerShell 7+

## Quick start

```powershell
# 1. Generate an environment file with real random secrets.
pwsh ./scripts/new-secrets.ps1

# 2. Start PostgreSQL 16 + Redis 7.
pwsh ./scripts/dev-up.ps1

# 3. Build the frontend. The Go binary embeds web/dist, so this is required
#    before the backend will compile.
pwsh ./scripts/build-web.ps1

# 4. Run the API (stays in the foreground).
pwsh ./scripts/dev-backend.ps1

# 5. In a second terminal, run the supported-Node frontend dev server.
cd web
bun run dev
```

Open **http://127.0.0.1:4173/** for frontend development. It proxies API calls
to the platform backend at `127.0.0.1:3001`. Port `3000` belongs to the
protected rc.16 baseline in `../new-api-infra`; it is never the product UI.

The backend's embedded production-style UI remains available at
http://127.0.0.1:3001/. After initial setup, seed the development brand
idempotently with `pwsh ./scripts/dev-seed-brand.ps1`.

Verify, in a second terminal:

```powershell
pwsh ./scripts/dev-health.ps1        # engine, containers, live DB query, Redis PING, API
pwsh ./scripts/dev-smoke-test.ps1    # isolated real relay chain; zero Provider cost
pwsh ./scripts/preflight-openrouter-egress.ps1 # key-free DNS/TLS/HTTP check
```

## Scripts

| Script                  | Purpose                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `new-secrets.ps1`       | Generate an env file with CSPRNG secrets. Never overwrites without `-Force`. |
| `dev-up.ps1`            | Start backing services; pre-flight host ports; wait for health.              |
| `dev-down.ps1`          | Stop the stack. Keeps volumes unless `-DeleteData`.                          |
| `dev-health.ps1`        | Honest health report. Non-zero exit on failure.                              |
| `build-web.ps1`         | Build the frontend into `web/dist`.                                          |
| `dev-backend.ps1`       | Build and run the Go API against the dev stack.                              |
| `dev-seed-brand.ps1`    | Store the deployment product name in the dev database. Idempotent.           |
| `dev-seed-channel.ps1`  | Create an upstream channel with neutral aliases and pricing. Idempotent.     |
| `dev-seed-openrouter-channel.ps1` | Create the isolated Phase 6A OpenRouter channel. Idempotent.       |
| `probe-openrouter.ps1` | Run layered, budget-capped direct OpenRouter validation.                       |
| `probe-hyc-openrouter.ps1` | Run the budget-capped HYC AI OpenRouter end-to-end probe.                  |
| `probe-claude-code-hyc.ps1` | Run one isolated, budget-capped Claude Code → HYC live probe.          |
| `run-claude-code-hyc.ps1` | Run the official Claude Code binary with child-only HYC configuration.  |
| `preflight-openrouter-egress.ps1` | Check DNS/TCP/TLS/key-free HTTP without inference or credentials. |
| `dev-seed-model-catalog.ps1` | Create two neutral dev catalog entries through the admin API. Idempotent. |
| `dev-smoke-test.ps1`    | Zero-cost end-to-end relay verification against a local deterministic stub.  |
| `backup-db.ps1`         | `pg_dump -Fc`, verified with `pg_restore -l`. Deletes unverifiable archives. |
| `restore-db.ps1`        | Restore, with a `-Verify` drill into a scratch database.                     |
| `rehearse-cutover.ps1`  | Full cutover rehearsal: real data, real migration, real relay request.       |
| `preflight-release.ps1` | Production readiness gate. Fails while launch blockers remain.               |
| `verify-nginx.ps1`      | `nginx -t` against the real production config.                               |
| `lint-guard.ps1`        | Lint ratchet — blocks new debt without hiding inherited debt.                |

## Ports

Chosen to coexist with the separate `new-api-infra` stack and to avoid
Windows/Hyper-V reserved TCP ranges.

| Service    | Dev              | Production     |
| ---------- | ---------------- | -------------- |
| Frontend   | `127.0.0.1:4173` | embedded / nginx |
| API        | `127.0.0.1:3001` | via nginx only |
| PostgreSQL | `127.0.0.1:5433` | not published  |
| Redis      | `127.0.0.1:6380` | not published  |
| nginx      | —                | `80`, `443`    |

## Model naming

Users see **platform-owned aliases**, never upstream model names:

```
platform-general-preview
platform-reasoning-preview
platform-code-preview      (not yet provisioned)
```

The mapping to a concrete upstream model lives only in the channel's
`model_mapping` and is stripped from non-admin logs. Changing provider is a
channel edit, not a customer-visible change.

A model is never described as belonging to a vendor that is not actually
serving it. See
[`docs/adr/0003-provider-abstraction-and-model-aliases.md`](./docs/adr/0003-provider-abstraction-and-model-aliases.md).

Public product metadata is available at `/model-catalog` and
`GET /api/platform/models`. It is stored separately from channels and pricing;
see [ADR 0007](./docs/adr/0007-product-model-catalog-and-pricing-aggregation.md).

Subscription product metadata and lifecycle are exposed by
`GET /api/platform/plans` and the authenticated `/my-subscription` console.
They extend the existing subscription price/order/quota authorities with
auditable `platform_subscription_*` companions; see
[ADR 0008](./docs/adr/0008-subscription-lifecycle-and-entitlements.md).

## Security

- Secrets live only in gitignored `deploy/.env.*` files. `deploy/.env.example`
  holds placeholders and is the only tracked variant.
- Production Compose declares every credential as `${VAR:?}` — the stack
  refuses to start rather than boot with a default.
- PostgreSQL and Redis are loopback-only in dev and unpublished in production.
- API tokens are shown in full only at creation and via an explicit,
  rate-limited reveal endpoint; listings return a masked value.
- Non-admin log views are stripped of upstream model, channel name and admin
  debug payloads.

- The dev API binds `127.0.0.1` only (`BIND_ADDRESS`); pass
  `dev-backend.ps1 -AllowLan` to expose it deliberately.

### Launch gate

`pwsh ./scripts/preflight-release.ps1` is the single answer to "may this serve
real customers". It fails while any launch blocker remains — missing AGPL §13
source offer, provisional pricing, placeholder secrets, insecure production
settings, floating image tag, or unverified nginx config. Production deploys
are hard-gated: `deploy/compose.prod.yaml` refuses to start without
`SOURCE_CODE_URL`.

See [`docs/legal-and-source-offer.md`](./docs/legal-and-source-offer.md).

## Documentation

| Document                                                                     | Contents                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md)                             | System shape, layering, request path, billing invariants |
| [`docs/reference-audit.md`](./docs/reference-audit.md)                       | Audit of seekgt.com — it is itself a stock New API rc.15 |
| [`docs/page-matrix.md`](./docs/page-matrix.md)                               | Every route, from source, with redesign priority         |
| [`docs/migration-plan.md`](./docs/migration-plan.md)                         | Database isolation, rc.16→rc.22 delta, cutover plan      |
| [`docs/upstream-sync.md`](./docs/upstream-sync.md)                           | How to take a new upstream release                       |
| [`docs/legal-and-source-offer.md`](./docs/legal-and-source-offer.md)         | AGPL obligations and the source-offer checklist          |
| [`docs/phase3-migration-rehearsal.md`](./docs/phase3-migration-rehearsal.md) | Executed cutover rehearsal, with results                 |
| [`docs/phase5a-model-catalog.md`](./docs/phase5a-model-catalog.md)           | Product model schema, APIs, boundaries and verification  |
| [`docs/phase5b-wallet-profile.md`](./docs/phase5b-wallet-profile.md)         | Wallet/Profile truth, security and verification          |
| [`docs/phase5c-subscriptions.md`](./docs/phase5c-subscriptions.md)           | Subscription data, lifecycle, APIs and verification      |
| [`docs/phase6a1-client-compatibility.md`](./docs/phase6a1-client-compatibility.md) | Claude Code/Cursor evidence boundaries and local regression |
| [`docs/phase6a2-claude-code-compatibility.md`](./docs/phase6a2-claude-code-compatibility.md) | Claude Code 500 root cause, fix and verification matrix |
| [`docs/openrouter-release-readiness.md`](./docs/openrouter-release-readiness.md) | Cost reconciliation, blockers and operator checklist |
| [`docs/openrouter-production-network.md`](./docs/openrouter-production-network.md) | DNS, TLS, proxy and SSE production requirements |
| [`docs/handoff-phase5d.md`](./docs/handoff-phase5d.md)                       | Phase 5D entry contract and safe extension points        |
| [`docs/handoff-phase5c.md`](./docs/handoff-phase5c.md)                       | Historical Phase 5C entry contract                       |
| [`docs/handoff-phase5b.md`](./docs/handoff-phase5b.md)                      | Historical Phase 5B entry contract                       |
| [`docs/handoff-phase4.md`](./docs/handoff-phase4.md)                         | File-level map for the next phase                        |
| [`docs/phase4-design-brief.md`](./docs/phase4-design-brief.md)               | Design and architecture constraints                      |
| [`docs/adr/`](./docs/adr/)                                                   | Architecture decision records                            |

## Relationship to `new-api-infra`

`new-api-infra` is a separate, stable stack that was **not modified**. It runs
New API rc.16 on port 3000 with its own volumes and database. This repository
uses entirely separate Compose project names, volumes and ports; both run side
by side.

Its database was read once, to copy an upstream provider key into the new
development database. That key was never written to this repository.

## Licence

GNU AGPL v3.0. See `LICENSE`, `NOTICE` and `THIRD-PARTY-LICENSES.md`.

Operating this as a network service triggers AGPL §13: users must be offered
the Corresponding Source of this modified version. That mechanism is **not yet
in place** and is required before any public launch.
