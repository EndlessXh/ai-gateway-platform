# Cutover rehearsal — executed 2026-07-28

A real rehearsal of the production version jump, run end to end. Not a
`pg_restore --list` check.

Reproduce with:

```powershell
pwsh ./scripts/rehearse-cutover.ps1
```

## What was rehearsed

Migrating the live `new-api-infra` dataset (New API **v1.0.0-rc.16**) onto the
product baseline (**v1.0.0-rc.22**), then confirming the service still relays,
logs and bills correctly on the migrated data.

## Safety model

| Guarantee | How |
|---|---|
| Baseline never written | Only `pg_dump` and `SELECT` against `new-api-dev-postgres-1` |
| Scratch is isolated | Restored into a throwaway database inside the **platform** postgres container, never the baseline one |
| No volume touched | No volume created, mounted or removed |
| Dev API undisturbed | Rehearsal instance on port 3150 and Redis logical DB 3 |
| No residue | Scratch database dropped in a `finally` block |

Verified after the run: baseline still reports `31|8|14|2|37|124980344`
(tables, users, tokens, channels, logs, total quota) — byte-identical to
before; baseline API still HTTP 200; zero `cutover_rehearsal_*` databases
remain; the six expected volumes are unchanged.

## Result

```
[1] Backing up baseline database (read-only)
    rollback point: deploy/backups/cutover-source-20260728-033652.dump (126.1 KB)

[2] Recording pre-migration state (source, rc.16)
    tables=31 users=8 tokens=14 channels=2 logs=37 quota_sum=124980344

[3] Restoring into scratch database
    restored: tables=31 users=8 tokens=14 channels=2 logs=37
    row counts match source

[4] Starting rc.22 binary against the scratch database (port 3150)
    service healthy on migrated data

[5] Verifying post-migration schema and data
    tables=34 (was 31)  users=8  tokens=14  channels=2  logs=37  quota_sum=124980344
    users, tokens, channels and total quota preserved exactly
    migration added: auth_flows external_identity_claims user_sessions

[6] Issuing a real relay request using migrated credentials
    relay OK: model=qwen-plus tokens=20 reply='CUTOVER_OK'

[7] Confirming logging and billing still work post-migration
    consumption logs written: 1 (before=37 after=38)
    token used_quota now: 19326

[8] Stopping rehearsal instance
```

### What each step actually proves

| Step | Proves |
|---|---|
| 3 | The dump restores with **zero row loss** on users, tokens and channels |
| 4 | rc.22's `AutoMigrate` runs to completion against real rc.16 data and the service reaches healthy |
| 5 | The migration is **additive**: 3 tables added, no rows changed, and `sum(users.quota)` is bit-identical — no billing drift |
| 6 | A token that existed **before** the migration still authenticates, routes and returns a correct completion afterwards |
| 7 | Consumption logging and quota deduction still function on migrated data — the accounting path survived |

Step 6 is the one that separates this from a restore test. It used a real
pre-existing token and a real upstream call, not a synthetic fixture.

## Schema delta, rc.16 → rc.22

Additive only. Three tables added, none removed or renamed:

- `auth_flows`
- `external_identity_claims`
- `user_sessions`

Consistent with rc.22's reworked session and external-identity handling.

## Rollback

The rehearsal writes its rollback point to `deploy/backups/` before touching
anything:

```
deploy/backups/cutover-source-<timestamp>.dump
```

To roll back a real cutover, restore that dump into the original database. Note
what this does **not** recover: New API migrations are forward-only, so any
writes made after the dump are lost. That is the actual cost of a rollback, and
why the maintenance window must stop writes first.

## Known gap for the real cutover

`SESSION_SECRET` differs between environments. Sessions do not survive a
change, so **every user will be logged out** at cutover. Channel keys are
unaffected: `CryptoSecret` is HMAC-only in this version and channel keys are
stored as plain text, so a differing `CRYPTO_SECRET` does not make them
unreadable.

Plan the logout into the maintenance announcement.

## Remaining before a production cutover

The rehearsal validates the mechanism, not the readiness of the product. Still
required:

1. The product is feature-complete (Phases 4–6).
2. `scripts/preflight-release.ps1 -Environment prod` reports no blockers.
3. A maintenance window with writes stopped.
4. Re-run this rehearsal against the *actual* production dataset — this run
   used the development baseline, which is smaller than production will be.
5. A restore rehearsal at production data volume, to measure real downtime.
