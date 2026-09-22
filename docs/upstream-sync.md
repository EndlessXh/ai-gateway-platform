# Syncing with upstream New API

This product is a **pinned fork** of [New API](https://github.com/QuantumNous/new-api).
It is never built from a floating `main` or a `latest` image.

|                      |                                              |
| -------------------- | -------------------------------------------- |
| Upstream remote      | `https://github.com/QuantumNous/new-api.git` |
| Current baseline     | `v1.0.0-rc.22`                               |
| Baseline commit      | `bc14c18f6024e79cba1c08d02cd007796e12d668`   |
| Annotated tag object | `942c1bb2593f3bac71ea9c84425afa3107a6cd5a`   |
| Local marker tag     | `upstream-baseline/v1.0.0-rc.22`             |

## Branches

| Branch                       | Role                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| `product/main`               | Release line. Always in a working, verified state.                         |
| `product/develop`            | Integration branch for in-progress work.                                   |
| `upstream-baseline/*` (tags) | Immutable markers recording which upstream commit each baseline came from. |

Upstream is fetched but never tracked directly: there is no local branch that
follows `upstream/main`.

## Which upstream release counts as "stable"

Upstream tags releases `v1.0.0-rc.N`, but **these are not marked as
pre-releases on GitHub**. `GET /repos/QuantumNous/new-api/releases/latest` —
which by definition excludes pre-releases and drafts — returns the newest
`rc` tag. Verified 2026-07-28: it returned `v1.0.0-rc.22` with
`prerelease: false`.

So "latest stable" means **the newest `v1.0.0-rc.N` tag**, despite the `rc`
spelling. Do not fall back to the `v0.9.x` line; it is older, not more stable.

Check with:

```powershell
$r = Invoke-RestMethod https://api.github.com/repos/QuantumNous/new-api/releases/latest `
     -Headers @{ 'User-Agent' = 'ai-gateway-platform' }
"$($r.tag_name)  prerelease=$($r.prerelease)  published=$($r.published_at)"
```

## Keeping the merge surface small

Every file we change is a future merge conflict. The rules that keep sync cheap:

**Product code lives in paths upstream does not use.** `deploy/`, `scripts/`
and the product `docs/*.md` files are additive — they cannot conflict, because
upstream has no files at those paths.

**Upstream files we deliberately own** (expect a conflict on every sync; resolve
by keeping ours and re-applying any upstream improvement by hand):

| File         | Why we own it                                                    |
| ------------ | ---------------------------------------------------------------- |
| `README.md`  | Product README. Retains upstream attribution.                    |
| `CLAUDE.md`  | Product agent rules; imports upstream `AGENTS.md` unchanged.     |
| `.gitignore` | Appended product ignore rules. Append-only, usually auto-merges. |

**Upstream files we have modified in place** — keep this list exhaustive and
short. Anything added here must be justified; prefer additive files.

| File                       | Change                                                       | Reason                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model/log.go`             | `formatUserLogs` also deletes `upstream_model_name`          | Provider isolation: non-admin log views must not disclose which upstream model served a request. Covered by `TestFormatUserLogsStripsUpstreamModelName`.                                     |
| `model/log_format_test.go` | Added that regression test                                   | Pins the rule above.                                                                                                                                                                         |
| `main.go`                  | `BIND_ADDRESS` env var prefixes the listen address (4 lines) | The host-run dev API otherwise listens on all interfaces and is LAN-reachable. Default stays empty so containers and production are unaffected. See `docs/adr/0004-development-topology.md`. |
| `controller/misc.go`       | Exposes resolved product identity, public compliance metadata and pricing status in `/api/status` | The public runtime must not inherit the upstream default as ordinary branding; legal attribution and pricing state remain separate API truths. |
| `controller/theme_compat_test.go` | Covers product identity, public compliance and pricing-status contracts | Prevents the Phase 4 runtime and legal/status surfaces from silently disappearing during an upstream sync. |

Additive product packages that upstream has no file at, and therefore cannot
conflict: `setting/platform/` (product brand resolution, licence-compliance
configuration, and tests); `model/platform_model_catalog.go`,
`service/platform_model_catalog.go`, `controller/platform_model_catalog.go`,
their tests, `web/src/features/model-catalog/`,
`web/src/routes/model-catalog/` and `web/e2e/phase5a-model-catalog.e2e.ts`.

Phase 5A also changes these existing upstream paths in place. Re-run catalog,
Pricing and Playground tests after resolving any future conflict:

- Backend integration: `model/main.go`, `model/pricing.go`,
  `controller/pricing.go`, `middleware/distributor.go`, `router/api-router.go`.
- Public navigation: `web/src/components/layout/config/top-nav.config.ts`,
  `web/src/hooks/use-top-nav-links.ts`.
- Models admin integration: `web/src/features/models/components/models-provider.tsx`,
  `index.tsx`, `section-registry.tsx`, `types.ts`.
- Playground integration: `web/src/components/model-group-selector.tsx`,
  `web/src/features/playground/hooks/use-playground-options.ts`,
  `lib/options/playground-option-utils.ts`, `types.ts`.
- Pricing integration: `web/src/features/pricing/api.ts`, `types.ts`,
  `hooks/use-pricing-data.ts`, `components/model-card.tsx` and
  `components/model-details.tsx`.
- Generated/localized integration: `web/src/routeTree.gen.ts` and
  `web/src/i18n/locales/{en,fr,ja,ru,vi,zh-TW,zh}.json` plus the sync report.

**Files we intentionally leave alone**, even though it would be convenient not
to:

- `.env.example` (root) — upstream's env-var reference. The product deployment
  template is `deploy/.env.example`; the two serve different purposes.
- `AGENTS.md`, `NOTICE`, `LICENSE`, `THIRD-PARTY-LICENSES.md` — legal and
  governance text. See `docs/adr/0002-agpl-attribution-obligations.md`.
- `go.mod` module path, package names, import paths, Docker image names —
  upstream's `AGENTS.md` protects these identifiers, and renaming them would
  create a repo-wide permanent conflict for zero product benefit.

## Sync procedure

1. **Confirm the target release and read its notes.**

   ```powershell
   git fetch upstream --tags
   # Review the changelog for the range you are about to take.
   git log --oneline upstream-baseline/v1.0.0-rc.22..v1.0.0-rc.NN
   ```

2. **Back up the development database**, so a failed migration is recoverable.

   ```powershell
   pwsh ./scripts/backup-db.ps1 -Label pre-upstream-sync
   ```

3. **Branch from `product/develop`.**

   ```powershell
   git switch product/develop
   git switch -c chore/upstream-v1.0.0-rc.NN
   ```

4. **Merge the tag, not a branch.** Merging a tag pins exactly what you took.

   ```powershell
   git merge v1.0.0-rc.NN
   ```

5. **Resolve conflicts** using the tables above. For files we own, keep ours and
   port any upstream change deliberately. For files we modified in place,
   re-apply our change on top of upstream's new version — do not blindly keep
   ours, or you will silently drop an upstream fix.

6. **Verify the schema delta before trusting it.** Restore the backup into a
   scratch database and let the new binary migrate it:

   ```powershell
   pwsh ./scripts/restore-db.ps1 -Path deploy/backups/<backup>.dump -Verify
   ```

7. **Rebuild and re-run the real checks.** A green build proves nothing about
   the relay chain.

   ```powershell
   pwsh ./scripts/build-web.ps1
   pwsh ./scripts/dev-backend.ps1        # in a second terminal
   pwsh ./scripts/dev-health.ps1
   pwsh ./scripts/dev-smoke-test.ps1     # live non-streaming + streaming + billing
   go test ./model/ ./common/ ./relay/...
   ```

8. **Record the new baseline** and merge to `product/main`.

   ```powershell
   git tag -a upstream-baseline/v1.0.0-rc.NN -m "Upstream New API v1.0.0-rc.NN (commit <sha>)"
   ```

   Then update the table at the top of this file and add an entry to the log
   below.

## Rollback

The baseline tags make this cheap. To abandon a sync mid-merge:

```powershell
git merge --abort
```

To roll back a completed but bad sync, revert the merge commit on
`product/develop` — do not reset a branch that has been pushed.

The database is the part that does not roll back automatically: New API
migrations are forward-only. This is precisely why step 2 takes a backup and
step 6 rehearses the migration on a copy first.

Phase 5C adds four product-owned `platform_subscription_*` tables and narrow
hooks in subscription migration, routing and the existing reset task. During an
upstream sync, keep upstream `subscription_plans`, `user_subscriptions`,
`subscription_orders`, quota selection and group restoration authoritative;
reapply the companion lifecycle hooks deliberately and rerun the idempotent
purchase/renewal/concurrency tests. Never resolve a conflict by copying price
or quota into the product profile.

## Sync log

| Date       | From | To             | Notes                                                                                    |
| ---------- | ---- | -------------- | ---------------------------------------------------------------------------------------- |
| 2026-07-28 | —    | `v1.0.0-rc.22` | Initial baseline. Clean migration on an empty PostgreSQL 16 database produced 34 tables. |
