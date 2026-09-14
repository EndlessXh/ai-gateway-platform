# Database migration plan

## Position

The existing `new-api-infra` stack is the **production-shaped baseline and
reference**. It is not the migration target and was not modified. Everything
below was executed against an **independent** development database.

|                 | Baseline (`new-api-infra`) | Platform (this repo)   |
| --------------- | -------------------------- | ---------------------- |
| Compose project | `new-api-dev`              | `ai-gateway-dev`       |
| App version     | New API `v1.0.0-rc.16`     | New API `v1.0.0-rc.22` |
| PostgreSQL      | 16.8-alpine                | 16.8-alpine            |
| Redis           | 7.4.2-alpine               | 7.4.2-alpine           |
| Database        | `newapi_dev`               | `aigw`                 |
| Volumes         | `new_api_dev_*`            | `ai_gateway_dev_*`     |
| App port        | `127.0.0.1:3000`           | `127.0.0.1:3001`       |
| DB port         | not published              | `127.0.0.1:5433`       |
| Redis port      | not published              | `127.0.0.1:6380`       |

Nothing in this repository can reach the baseline's volumes: different project
name, different volume names, different ports. Both stacks run side by side.

## What was actually done

### 1. Audited the baseline (read-only)

```
PostgreSQL 16.8 on x86_64-pc-linux-musl
database: newapi_dev
31 tables in public schema
```

### 2. Took a verified backup of the baseline

```
deploy/backups/baseline-newapi_dev-20260728-021944.dump   126.1 KB
```

Verified rather than assumed: header bytes are `PGDMP`, and `pg_restore -l`
parsed the archive cleanly and listed **328 TOC entries**.

> A backup written with PowerShell's `>` redirection passes binary through the
> text/encoding layer and can be corrupted. `scripts/backup-db.ps1` therefore
> dumps inside the container and copies the file out with `docker cp`, then
> proves the result with `pg_restore -l` and **deletes any archive that fails
> verification** rather than leaving a false sense of safety.

### 3. Migrated a clean database on the new version

The rc.22 binary was pointed at an empty `aigw` database and ran its own
`AutoMigrate`. Result: **34 tables**, no errors.

### 4. Compatibility check, rc.16 → rc.22

Three tables are new in rc.22; none were removed or renamed:

| Table                      | Present in rc.16 | Present in rc.22 |
| -------------------------- | ---------------- | ---------------- |
| `auth_flows`               | no               | **yes**          |
| `external_identity_claims` | no               | **yes**          |
| `user_sessions`            | no               | **yes**          |

All 31 baseline tables exist in rc.22 with the same names, including the
billing- and identity-critical ones: `users`, `tokens`, `channels`, `logs`,
`quota_data`, `redemptions`, `top_ups`, `abilities`, `options`,
`subscription_*`, `casbin_rule`, `authz_roles`.

The additions are consistent with rc.22's reworked session and external
identity handling. This is an additive migration — the risk is forward-only
migration, not data loss.

### 5. Verified the running system

`/api/status` returned HTTP 200 with `success: true`, and the full relay chain
was exercised end to end (see `scripts/dev-smoke-test.ps1` results in the
README).

### 6. Rehearsed the full cutover (Phase 3.5)

A complete rehearsal was executed on 2026-07-28: the live rc.16 dataset was
dumped, restored into a scratch database, migrated by the rc.22 binary, and
then exercised with a **real relay request using a pre-existing migrated
token**, confirming logging and quota deduction still work afterwards.

All rows preserved exactly (8 users, 14 tokens, 2 channels, total quota
124,980,344 unchanged); 31 → 34 tables. Full transcript and the safety model:
`docs/phase3-migration-rehearsal.md`. Repeat with
`pwsh ./scripts/rehearse-cutover.ps1`.

## Not done, deliberately

**The baseline's data was not migrated into the platform database.** Only the
upstream provider _channel_ was reproduced, and only as configuration — its key
was read from the baseline and POSTed straight to the new admin API, never
written to disk or into this repository.

Migrating real users, tokens, quota and logs is a **cutover** activity, not a
development one. It needs decisions this session cannot make on its own:
whether historical logs move at all, how quota balances reconcile, and what
downtime is acceptable. Doing it now would also mean running a
forward-only migration against a copy of production data before the product is
finished.

## When a real cutover happens

Preconditions: the product is feature-complete, and rc.22 has been running on
a copy of production data for long enough to trust.

1. Announce a maintenance window. New API migrations are forward-only; the
   rollback path is "restore the backup", which means losing writes made after
   the dump.
2. Stop writes to the baseline.
3. `pg_dump -Fc` the baseline; verify with `pg_restore -l`.
4. Restore into a **scratch** database and let the rc.22 binary migrate it:
   `pwsh ./scripts/restore-db.ps1 -Path <dump> -Verify`. This is a rehearsal —
   it creates a throwaway database and drops it.
5. Confirm the post-migration table set matches a clean rc.22 install, and that
   row counts for `users`, `tokens`, `channels` and `quota_data` match the source.
6. Re-key if required. `CRYPTO_SECRET` is HMAC-only in this version and channel
   keys are stored as plain text, so keys survive a secret change — but
   `SESSION_SECRET` differs between environments, so **all existing sessions
   will be invalidated** and users must log in again. Plan for that.
7. Restore into the real target, run `scripts/dev-health.ps1` and
   `scripts/dev-smoke-test.ps1` equivalents against production config.
8. Keep the pre-cutover dump until the new stack has run clean for an agreed
   period.

## Product tables (not yet created)

Product-specific tables are additive and prefixed so they never collide with an
upstream `AutoMigrate`:

`platform_plans`, `platform_subscriptions`, `platform_model_catalog`,
`platform_payment_orders`, `platform_announcements`, `platform_provider_costs`,
`platform_audit_events`

None exist yet — nothing in Phase 0–2 needed them, and creating unused tables
would be speculative. They arrive with the features that use them.

Constraint that does not bend: **core billing columns keep their upstream types
and semantics.** Quota columns are 32-bit integers, and `common/quota_math.go`
saturates to `int32` on that basis. Widening or reinterpreting them would
silently break the overflow guards described in `AGENTS.md`.
