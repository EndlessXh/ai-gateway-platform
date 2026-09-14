# ADR 0004 — Development topology and environment isolation

- Status: Accepted
- Date: 2026-07-28

## Context

`new-api-infra` is a working, stable stack with real data and a configured
provider channel. It must not be disturbed. The new product needs its own
PostgreSQL 16 and Redis 7, on the same Windows/Docker Desktop machine, at the
same time.

The Go binary embeds `web/dist` via `//go:embed`, so the frontend must be built
before the backend compiles at all.

## Decision

**Backing services in Docker; application on the host during development.**

`deploy/compose.dev.yaml` owns PostgreSQL and Redis. The Go API runs natively
via `scripts/dev-backend.ps1`. The containerised app exists behind the `app`
Compose profile for verifying the production image.

Rebuilding a ~115 MB Go image on every edit is far slower than `go build`, and
the frontend needs Rsbuild HMR on the host.

**Isolation is structural, not conventional:**

|            | Baseline         | Platform           |
| ---------- | ---------------- | ------------------ |
| Project    | `new-api-dev`    | `ai-gateway-dev`   |
| Volumes    | `new_api_dev_*`  | `ai_gateway_dev_*` |
| App port   | `127.0.0.1:3000` | `127.0.0.1:3001`   |
| PostgreSQL | not published    | `127.0.0.1:5433`   |
| Redis      | not published    | `127.0.0.1:6380`   |

**Dev publishes database ports on loopback; production does not.** A host-run
API cannot reach a container on an `internal` network, so the dev network is a
normal bridge with `127.0.0.1`-bound ports. Production keeps
app/postgres/redis on `internal: true` with no published ports; only nginx is
exposed.

**Host ports must avoid Windows reserved ranges.** The first choice, 15433,
failed with _"An attempt was made to access a socket in a way forbidden by its
access permissions"_ — not "address in use". Hyper-V reserves large TCP blocks
(15334–15533 among them). Ports are now 5433/6380, verified bindable, and
`dev-up.ps1` pre-flights every host port so this failure is diagnosed up front
rather than mid-`up`. List the ranges with
`netsh interface ipv4 show excludedportrange protocol=tcp`.

**Bun is the frontend package manager**, per upstream. The repository ships
`bun.lock` and no `package-lock.json`; using npm would resolve a different
dependency graph. Installed user-scoped to `%USERPROFILE%\.bun` — no admin
rights, no global Node changes.

## Consequences

**Good.** Both stacks run side by side with no possible interference. Fast edit
loop. Production keeps strict network isolation without compromising dev
ergonomics.

**Cost.** Dev and production topologies differ, so the containerised path needs
periodic exercise via the `app` profile — otherwise "works in dev" can hide a
broken image build. Bun is an extra prerequisite.

**Resolved in Phase 3.5 — host binding.** Upstream binds `":" + port`
(`main.go`), so the host-run API listened on **all interfaces**. Measured, not
assumed: the listener was `::` and `/api/status` answered on all five local
interfaces including the real LAN address.

Fixed with a four-line change in `main.go` reading `BIND_ADDRESS`. The default
stays empty (all interfaces) because containers require it — Docker's port
mapping connects from outside the container's network namespace, so binding
loopback inside the container would make the published port unreachable.
`scripts/dev-backend.ps1` sets `BIND_ADDRESS=127.0.0.1` unless `-AllowLan` is
passed.

Verified after the change: listener is `127.0.0.1:3001`, loopback returns
HTTP 200, and all five LAN interfaces are refused.

This was accepted as an in-place upstream modification (recorded in
`docs/upstream-sync.md`) because the alternative — firewall rules the developer
must maintain by hand — is fragile and easy to forget.

**Rejected — reuse the baseline's database.** Directly violates the brief and
risks the one known-good environment.

**Rejected — containerise the app in dev.** Image rebuild per edit is too slow
and breaks frontend HMR.
