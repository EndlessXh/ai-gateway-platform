# CLAUDE.md — AI Gateway Platform

@AGENTS.md

The import above pulls in the **upstream New API engineering rules** (JSON
wrappers, cross-database compatibility, billing safety invariants, relay
conventions, test quality, protected identifiers). Those rules remain in force
in full. This file adds product-specific rules on top and overrides only where
explicitly stated.

## What this repository is

A pinned fork of New API `v1.0.0-rc.22`
(commit `bc14c18f6024e79cba1c08d02cd007796e12d668`), developed into a
commercial AI gateway product.

Read before making architectural changes:
`docs/architecture.md`, `docs/upstream-sync.md`, `docs/adr/`.

## Non-negotiables

### 1. Attribution is not branding

`LICENSE`, `NOTICE`, `THIRD-PARTY-LICENSES.md` are never modified or removed.
The AGPLv3 §7 attribution string and the link to
`https://github.com/QuantumNous/new-api` must remain visible in the footer and
`/about`, and must **not** be routed through brand configuration — no config
value may render them empty.

Go module path, package names, import paths and upstream Docker image
references stay as they are. Upstream `AGENTS.md` protects these identifiers.

See `docs/adr/0002-agpl-attribution-obligations.md`.

### 2. Do not touch `new-api-infra`

`../new-api-infra` is a separate stable stack. Never modify, restart
destructively, reset, or write to its volumes, database or config. Reading from
it is acceptable only when explicitly asked.

Never reuse its Compose project name, volume names or ports (3000, `new_api_dev_*`).

### 3. Keep the upstream merge surface small

Product code goes in `deploy/`, `scripts/`, `docs/` — paths upstream does not
use, which therefore cannot conflict.

Modifying an upstream file is a lasting cost. Before doing it: prefer an
additive file; if unavoidable, add it to the table in `docs/upstream-sync.md`
with a reason, and cover it with a test.

### 4. Provider isolation

Users see platform aliases (`platform-*-preview`), never upstream model names.
Mapping lives only in the channel's `model_mapping`.

- Never describe a model as belonging to a vendor that is not serving it. Do
  not call a Bailian-backed model "Claude" or "Anthropic".
- Non-admin log views must not disclose upstream model or channel names.
  Pinned by `TestFormatUserLogsStripsUpstreamModelName`.
- Admin views keep full routing detail for debugging.

### 5. Secrets

Never commit a credential. Secrets belong only in gitignored `deploy/.env.*`.
`deploy/.env.example` contains placeholders only.

Do not echo secret values to the console, write them into logs or docs, or pass
them as command-line arguments. Generate with
`[System.Security.Cryptography.RandomNumberGenerator]` — never `Get-Random`.

`CRYPTO_SECRET` and `SESSION_SECRET` must differ, and differ per environment.

### 6. Billing safety

Quota columns are 32-bit. All conversion goes through `common/quota_math.go`
(`QuotaFromFloat`, `QuotaRound`, `QuotaFromDecimal`). Never a bare
`int(float64(quota) * ratio)` cast, never a new local rounding helper, never a
widened quota type. See the billing section of `AGENTS.md`.

New product tables use the `platform_` prefix and never alter core billing
column types or semantics.

### 7. Guards that must keep working

These exist because the failure they prevent is expensive. Do not weaken one to
make a check pass.

| Guard                           | Enforces                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scripts/preflight-release.ps1` | Launch blockers: AGPL §13 source offer, approved pricing, real secrets, production security posture, pinned image tag |
| `scripts/lint-guard.ps1`        | No new lint debt. Baseline `web/.oxlint-baseline.json` may fall, never rise.                                          |
| `scripts/verify-nginx.ps1`      | nginx config syntax, against the real files                                                                           |
| `scripts/rehearse-cutover.ps1`  | Migration safety, with a real request on migrated data                                                                |
| CI `release-gate`               | That the production gate still refuses an unconfigured deploy                                                         |

If a guard blocks you, fix the cause. Editing the baseline by hand, adding
`continue-on-error`, or relaxing a rule to go green is not acceptable.

`SOURCE_CODE_URL` must never be given a plausible-looking fake value — an empty
value is honest and blocks; a fake one passes and violates the licence.

## Working practice

### Verify against reality

- A green build is not a passing feature. Business changes are verified with
  `scripts/dev-smoke-test.ps1`, which makes real streaming and non-streaming
  calls and asserts logs and quota movement.
- Never report a command, test or migration as run when it was not.
- Never disable billing (e.g. self-use mode) to make a test pass — see
  `docs/adr/0005-provisional-model-pricing.md`.
- Never substitute static fixtures for a feature that is supposed to be
  connected.

### Commands

```powershell
pwsh ./scripts/dev-up.ps1            # PostgreSQL 16 + Redis 7
pwsh ./scripts/build-web.ps1         # required before the Go build
pwsh ./scripts/dev-backend.ps1       # run the API
pwsh ./scripts/dev-health.ps1        # real health check
pwsh ./scripts/dev-smoke-test.ps1    # live end-to-end chain

cd web; bun run typecheck            # tsgo
cd web; bun run lint                 # oxlint
go build ./...
go test ./model/ ./common/
```

All shell work is PowerShell 7 on Windows.

### Frontend

- `bun`, not npm/yarn/pnpm. The lockfile is `bun.lock`.
- `web/dist` is embedded via `//go:embed`; it must exist before `go build`.
- Upstream's `VERSION` file is empty (populated by their release CI).
  `build-web.ps1` falls back to the pinned tag — do not "fix" it by writing a
  version into that file, which would conflict on every sync.
- All user-facing text goes through `i18next`; see `web/AGENTS.md`.
- Inherit the existing design tokens and components. Do not introduce a second
  UI library, a second styling system, or React-only animation dependencies
  without an ADR.

### Visual claims

This agent has no reliable visual judgement without real image input. Do not
claim a page "looks better", matches a screenshot, or passed visual QA.

Verifiable instead: DOM structure, CSS values, computed layout, breakpoints,
accessibility tree, type checks, lint, build output, runtime errors.

## Before finishing a task

Report:

1. Confirmed facts, separated from assumptions
2. Scope changed and scope deliberately untouched
3. Files changed, with reasons
4. Commands actually executed, with real output
5. Risks and rollback
6. What still needs human, visual or production verification

If verification could not run, say so plainly. Do not describe it as passed.
