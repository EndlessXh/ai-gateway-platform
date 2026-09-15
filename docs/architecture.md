# Architecture

## Shape

A **modular monolith**. One Go binary serves the relay API, the management API,
and the embedded React frontend. PostgreSQL 16 is the system of record; Redis 7
is cache and coordination. No microservices, no message broker, no service mesh.

At current and foreseeable scale the monolith is the right call: the expensive
correctness surface is billing, and keeping quota pre-consumption and settlement
inside one process and one transactional database avoids distributed-consistency
problems that would otherwise have to be solved for no benefit.

```
                      ┌──────────────────────────────┐
   browser ──────────▶│  nginx (production only)     │
   API client ───────▶│  TLS, SSE, rate limit, HSTS  │
                      └───────────────┬──────────────┘
                                      │ HTTP (internal network)
                      ┌───────────────▼──────────────┐
                      │  ai-gateway (Go / Gin)       │
                      │                              │
                      │  router → controller →       │
                      │  service → model (GORM)      │
                      │                              │
                      │  relay/  provider adapters   │
                      │  web/dist embedded via       │
                      │  //go:embed                  │
                      └───────┬──────────────┬───────┘
                              │              │
                  ┌───────────▼───┐   ┌──────▼────────┐
                  │ PostgreSQL 16 │   │   Redis 7     │
                  │ system of     │   │ cache, rate   │
                  │ record        │   │ limit, locks  │
                  └───────────────┘   └───────────────┘
                              │
                              │ outbound, per channel
                  ┌───────────▼───────────────────────┐
                  │ upstream providers                │
                  │ (OpenAI-compatible, Anthropic,    │
                  │  Bedrock, Gemini, ...)            │
                  └───────────────────────────────────┘
```

## Layering

Upstream's convention, unchanged:

```
router/      HTTP routing
controller/  request handling, validation
service/     business logic
model/       persistence (GORM)
relay/       provider adapters and relay pipeline
middleware/  auth, rate limiting, distribution
setting/     runtime configuration (ratios, pricing, operations)
common/      shared utilities, quota arithmetic
web/         React 19 + TypeScript frontend (Rsbuild, TanStack Router)
```

Two rules from upstream `AGENTS.md` that constrain all product work:

- **JSON goes through `common.Marshal` / `common.Unmarshal`**, never
  `encoding/json` directly.
- **All database code must work on SQLite, MySQL and PostgreSQL.** Even though
  this product deploys PostgreSQL only, upstream code and future merges assume
  portability — breaking it turns every sync into a conflict.

## Product layer

Product code is kept in paths upstream does not use, so it cannot conflict on
merge:

```
deploy/      Compose stacks, nginx config, env template
scripts/     PowerShell 7 operations
docs/        product documentation and ADRs
```

Upstream files modified in place are listed exhaustively in
`docs/upstream-sync.md`. Product-specific packages and documentation remain
additive wherever possible; Phase 5A necessarily adds narrow integration
points to migration, routing, distribution, Pricing and the existing Models /
Playground surfaces.

## Product model catalog

`platform_model_catalog` is the product presentation layer for stable public
aliases. It owns names, bilingual descriptions, allowlisted capabilities and
modalities, availability, surface visibility and API enablement. It owns no
price, upstream model name, channel ID, URL or key.

The catalog service joins metadata to existing truths at read time:

```
platform_model_catalog ── presentation and product switches
abilities + channels ──── route existence and group accessibility
ratio_setting ─────────── price and billing truth
```

The public Models page, Pricing enrichment and minimal Playground hook share
this contract. See ADR 0007 and `docs/phase5a-model-catalog.md`.

## Account ledger and identity

Phase 5B adds no account table. `users.quota` remains current credit,
`users.used_quota` remains settled lifetime consumption and
`users.request_count` remains the request counter. Wallet reads those values
through the authenticated self API, joins recent consumption from `logs` and
funding history from `top_ups`, and formats them with the existing quota and
currency helpers. A missing source is unavailable—not zero.

Profile is another view over the same authenticated user. Display-name edits
write through the existing self-update path and refresh the shared client auth
user. Username, group, role/status, quota and creation identity remain
server-controlled. Password changes advance auth/session versions.

Browser Sessions remain `user_sessions`. Self-service queries and revocations
are scoped by authenticated user ID; PATs cannot administer browser Sessions.
The API exposes individual, other and all-Session revocation. IPs are reduced
before presentation and raw user-agent detail is not used as a durable product
identity. See `docs/phase5b-wallet-profile.md`.

## Subscription product lifecycle

Phase 5C preserves the upstream billing authorities and adds a product
companion layer:

```text
subscription_plans + user_subscriptions + subscription_orders
                         │ price, period, quota and financial truth
                         ▼
platform_subscription_plan_profiles + lifecycles + events + requests
                         │ stable key, state, snapshots, audit, idempotency
                         ▼
public plan API + /my-subscription + administrator diagnostics
```

Wallet purchase and renewal use one locked transaction. Subscription quota is
an independent period pool consumed before optional Wallet overflow; group and
model access continue to use upstream subscription/group/channel resolution.
The existing reset task and an explicit administrator reconcile route execute
idempotent boundary transitions. See ADR 0008 and
`docs/phase5c-subscriptions.md`.

## Request path

A relay request, end to end:

1. `middleware` authenticates the `sk-` token, resolves the user and group, and
   applies rate limits.
2. The requested model is a **platform alias**, not an upstream model name.
3. Channel distribution selects a channel able to serve that alias.
4. The channel's `model_mapping` rewrites the alias to the concrete upstream
   model. This is the only place the mapping exists (ADR 0003).
5. Billing estimates cost and **pre-consumes** quota. Insufficient quota fails
   here, before any upstream call.
6. The relay adapter calls the provider, streaming (SSE) or buffered.
7. Settlement reconciles actual token usage against the pre-consumed amount.
8. A consumption log is written. Non-admin views are stripped of
   `upstream_model_name`, channel ID/name, upstream request ID, `admin_info`
   and `audit_info`.

### OpenRouter private route

Phase 6A adds one isolated `provider-spike` route for `claude-opus-4.6`. It
reuses the OpenAI-compatible adapter and the existing Anthropic Messages
conversion chain. The server owns provider privacy parameters; user routing
controls and OpenAI metadata are rejected. Anthropic Messages metadata is
accepted as a client field and discarded before the upstream request. Public Chat, Messages and Responses payloads
are re-encoded with the public model and local response IDs, and OpenRouter
headers/errors are removed or classified before returning to users. See ADR
0009 and `docs/phase6a-openrouter-validation.md`.

Phase 6A.1 keeps that adapter and routing unchanged. Its default relay smoke
starts an isolated gateway with run-scoped SQLite state and a loopback-only
upstream stub, proving the conversion, streaming, error and billing lifecycle
without a Provider key. Live compatibility probes are separate, explicit and
budget-capped. Provider HTTP requests inherit the inbound request context so a
client disconnect cancels upstream work. Production egress and SSE edge
requirements are documented in `docs/openrouter-production-network.md`.

Phase 6A.2 adds no adapter. It makes routing validation input-format aware so
the official Claude Code client can use legal Anthropic metadata without
weakening OpenRouter controls. Conflicting Anthropic credential headers fail
closed, Claude tool choice is mapped explicitly, and terminal OpenRouter
stream errors become sanitized Claude `event: error` events. The native client
launcher uses child-only HYC configuration and bounded output/thinking limits.

## Billing invariants

Inherited from upstream and **not to be weakened**:

- Quota columns are 32-bit integers. All conversion goes through
  `common/quota_math.go`, which saturates to `int32` and logs every clamp.
- No bare `int(...)` casts on computed quota. Use `QuotaFromFloat`,
  `QuotaRound`, `QuotaFromDecimal`.
- Every user-controlled billing multiplier is bounded at request validation.
- A charge can never be negative.

Widening quota types or adding a local rounding helper would silently disable
these guards.

## Security posture

| Concern         | Development                                                  | Production                                      |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| TLS             | none (loopback HTTP)                                         | nginx, TLS 1.2/1.3, HSTS                        |
| App exposure    | `127.0.0.1` only via `BIND_ADDRESS` (`-AllowLan` to opt out) | internal network only, via nginx                |
| Frontend dev    | `127.0.0.1:4173`, strict port; API proxy to `127.0.0.1:3001` | n/a                                             |
| PostgreSQL      | `127.0.0.1:5433`                                             | internal network, no published port             |
| Redis           | `127.0.0.1:6380`                                             | internal network, no published port             |
| Cookies         | `SESSION_COOKIE_SECURE=false`                                | `true` + explicit trusted origins               |
| Trusted proxies | `none` (strict)                                              | nginx subnet only                               |
| Secrets         | `deploy/.env.dev`, gitignored                                | `deploy/.env.prod`, gitignored, never defaulted |

Compose uses `${VAR:?}` for every credential in production, so the stack refuses
to start rather than booting with a default password.

Token keys are shown in full only at creation and via an explicit, rate-limited
reveal endpoint (`POST /api/token/:id/key`); listings return a masked value.

## Frontend

React 19 + TypeScript, Rsbuild, TanStack Router/Query/Table, Tailwind CSS 4,
Base UI, `next-themes` for light/dark. Routes are file-based under
`web/src/routes/`; the full inventory is in `docs/page-matrix.md`.

The build output is **embedded into the Go binary** (`//go:embed web/dist`), so
`web/dist` must exist before the backend compiles. `scripts/build-web.ps1`
handles this and works around upstream's empty `VERSION` file (populated by
their release CI) by falling back to the pinned tag.

## Release gating

`scripts/preflight-release.ps1` is the single gate answering "may this serve
real customers". It fails while any launch blocker remains: no AGPL §13 source
offer, provisional pricing, placeholder or duplicated secrets, insecure
production cookie/proxy settings, a floating image tag, or unverified nginx
configuration.

Development reports the same blockers but does not fail, so they stay visible
from day one instead of surfacing on deploy day. The CI `release-gate` job
asserts the gate still refuses an unconfigured production deploy — if that job
ever passes, the gate has been weakened.

Licence-compliance configuration lives in `setting/platform/compliance.go`, an
additive package. Attribution values are constants there specifically so brand
configuration cannot blank them (ADR 0002, `docs/legal-and-source-offer.md`).

## Deferred deliberately

- **Additional product tables** (`platform_*`) — add only with the feature that
  needs them. Phase 5A adds `platform_model_catalog`; no wallet/profile table
  has been created speculatively (`docs/migration-plan.md`).
- **Brand configuration module** — Phase 4. Attribution is _not_ part of it and
  must remain non-suppressible (ADR 0002).
- **AGPL §13 source publication** — the enforcement mechanism exists; actually
  publishing the source and setting `SOURCE_CODE_URL` is a human task and
  remains a launch blocker (`docs/legal-and-source-offer.md`).
- **Real pricing** — ADR 0005; the single source of truth is settled in
  ADR 0006.
