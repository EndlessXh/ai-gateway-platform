# Licence compliance and the source-code offer

This product is a **modified version of [New API](https://github.com/QuantumNous/new-api)**,
licensed under **GNU AGPL-3.0** with additional terms under **Section 7(b)**
(see `NOTICE`).

This document is the operational checklist. The reasoning is in
`docs/adr/0002-agpl-attribution-obligations.md`.

## The three obligations

### 1. §7(b) — attribution must be preserved

`NOTICE` requires, verbatim, in the Appropriate Legal Notices **and** in a
prominent about/legal/footer/attribution location in the UI:

> "Frontend design and development by New API contributors."

plus a visible link to `https://github.com/QuantumNous/new-api`.

**How this is enforced.** These values are Go constants in
`setting/platform/compliance.go`, not environment variables:

```go
UpstreamProjectName = "New API"
UpstreamProjectURL  = "https://github.com/QuantumNous/new-api"
AttributionNotice   = "Frontend design and development by New API contributors."
```

There is deliberately no `UPSTREAM_PROJECT_NAME` or `ATTRIBUTION_NOTICE`
environment variable. Brand configuration owns the product name, logo and
marketing copy; it has no switch that can blank a legal notice, because a
misconfiguration would then silently become a licence violation.

Two guards back this up:
- `TestAttributionIsNotConfigurable` fails if the constants are turned into
  environment lookups.
- `scripts/preflight-release.ps1` fails if an env file defines
  `UPSTREAM_PROJECT_NAME`, `UPSTREAM_PROJECT_URL` or `ATTRIBUTION_NOTICE`.

### 2. §7(c) — changes must be marked

`docs/upstream-sync.md` maintains an exhaustive list of every modified upstream
file with the reason. Product code otherwise lives in additive paths
(`deploy/`, `scripts/`, `docs/`, `setting/platform/`).

At the time of writing, three upstream files are modified:

| File | Change |
|---|---|
| `model/log.go` | Strip `upstream_model_name` from non-admin log views |
| `model/log_format_test.go` | Regression test for the above |
| `main.go` | `BIND_ADDRESS` support so the dev server can bind loopback |

### 3. §13 — network use triggers a source offer

**This is the obligation most easily missed.** AGPL §13 means that running this
as a hosted service — even without ever distributing a binary — requires
offering users the Corresponding Source of the version they are talking to.

A private fork is not private once it serves the public.

**How this is enforced.** `SOURCE_CODE_URL` must point at a publicly reachable
location serving *this* modified source.

- `deploy/.env.example` ships it **empty**. A plausible-looking fake URL would
  be worse than nothing: it would pass a naive "is it set" check while
  satisfying no obligation.
- `deploy/compose.prod.yaml` declares it `${SOURCE_CODE_URL:?...}`, so the
  production stack refuses to start without it.
- `scripts/preflight-release.ps1` fails when it is empty, contains a
  placeholder marker (`example.com`, `replace_me`, `localhost`, …), or is not
  `https://`.
- The CI `release-gate` job asserts that a production preflight against the
  unmodified template **fails** with an `AGPL-13` blocker. If that job ever
  passes, the gate has been weakened.

Development may leave it empty. It is reported as a launch blocker every time
`preflight-release.ps1` runs, so it stays visible rather than surfacing on
deploy day.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `SOURCE_CODE_URL` | **production** | Public location of this modified source (AGPL §13) |
| `LICENSE_NOTICE_URL` | optional | Hosted copy of licence/notices; `LICENSE` and `NOTICE` ship regardless |

Attribution constants are **not** configuration. Do not add env vars for them.

## Before going live

This is a real, unfinished task — not a formality.

1. **Publish the source.** Push this repository (including product
   customisations) somewhere users can reach: a public Git host, or a
   downloadable archive served over HTTPS. It must correspond to the running
   version.
2. **Set `SOURCE_CODE_URL`** in `deploy/.env.prod` to that location.
3. **Keep it current.** Each deploy must be able to offer *its* source. Tag
   releases and either publish per-release archives or ensure the URL always
   serves the deployed commit.
4. **Verify** `pwsh ./scripts/preflight-release.ps1 -Environment prod` reports
   no `AGPL-13` blocker.
5. **Render the notices.** Phase 4 must surface, in the footer and `/about`:
   - the attribution string
   - a link to the upstream project
   - a link to `SOURCE_CODE_URL`
   - the licence name

   Phase 4 owns the visual treatment. It does not own whether they appear.

## Current status

| Obligation | Status |
|---|---|
| §7(b) attribution preserved as non-configurable constants | **Done** — tested |
| §7(b) rendered in footer/about UI | **Not done** — Phase 4; config surface is ready |
| §7(c) changes marked | **Done** — `docs/upstream-sync.md` |
| §13 source published and `SOURCE_CODE_URL` set | **NOT DONE — LAUNCH BLOCKER** |
| §13 enforcement so it cannot be forgotten | **Done** — compose, preflight, CI gate |

The mechanism guarantees the product cannot be deployed to production with the
obligation unmet. It does not, and cannot, publish the source for you.

## Third-party licences

`THIRD-PARTY-LICENSES.md` and the Apache-2.0 notices in `NOTICE` must ship with
Docker images, binaries and frontend bundles. `NOTICE` states this explicitly.
Do not add build steps that strip them.
