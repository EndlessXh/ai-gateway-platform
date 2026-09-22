# Phase 4.7 — internationalization completeness and E2E Session hygiene

Date: 2026-07-29
Scope: Phase 4 public/auth/error/shell copy and test-only Session lifecycle. No
Phase 5 feature work is included.

## Internationalization audit and repair

The Phase 4 components already read their copy through `t()`, but 95 keys in
`web/src/i18n/locales/zh.json` still contained the English source text. The
affected surface covered the landing hero, capability and integration copy,
pricing explanations, authentication shell, footer description and links,
legal/support/source labels, recovery errors, and Phase 4 dashboard-shell
status copy. This was a resource-completeness defect, not a second set of JSX
hard-coded strings.

The project keeps its existing single i18next `translation` namespace and flat
resource shape; Phase 4 keys are grouped by the existing static-key registry
rather than introducing a parallel i18n system. Canonical resources are:

- `web/src/i18n/locales/en.json`
- `web/src/i18n/locales/zh.json` (`zhCN` at runtime)
- `web/src/i18n/static-keys.ts`

`web/src/main.tsx` now also reapplies the localized description, Open Graph
description and Twitter description on `languageChanged`. Brand and technical
identifiers remain invariant: HYC AI, New API, OpenAI, Claude Messages API,
SSE, API paths and model aliases are not translated.

| English | zhCN |
|---|---|
| API Key | API 密钥 |
| Usage Logs | 使用日志 |
| Quota | 额度 |
| Pricing | 模型定价 |
| Provider / upstream channel | 服务提供商 / 上游渠道 |
| Gateway | 网关 |
| Streaming | 流式响应 |
| Source Code | 源代码 |
| Legal | 法律信息 |
| Documentation | 文档 |

The scoped guard in `web/src/i18n/phase4-i18n.test.ts` checks that every Phase
4 key exists in en and zhCN, that the Chinese resource cannot silently equal
the English fallback, and that interpolation variables match. Browser render
tests cover home, pricing, sign-in/auth shell, footer and 404 in both locales,
including opposing-language absence, raw-key detection, direct navigation,
reload persistence, invariant identifiers and horizontal overflow.

## Session root cause and cleanup design

Every successful login inserts a server-side `user_sessions` row. Closing a
Playwright context only discards browser state; it neither calls logout nor
removes the database row. Formal logout revokes the current Session but the
rolling issuance limit still counts recently created rows. Repeated suites
therefore eventually receive `AUTH_SESSION_LIMIT` (HTTP 409). The old helper's
`delete from user_sessions` workaround was unsafe because it deleted ordinary
user Sessions as well.

All E2E browser contexts now use a `HYC-E2E/<run-id>/...` user-agent marker.
`signInAsRoot` returns the exact Session SID and reports credentials-invalid,
Session-limit, rate-limit, network and server failures separately.
`withRootSession` always runs cleanup in `finally`: it first calls the formal
logout path, then invokes the local-only cleanup script for that exact marked
SID. This second step removes the revoked row from the issuance window without
changing either production Session limit.

`scripts/cleanup-e2e-sessions.ps1` is dry-run by default, requires the exact
development Compose project, rejects production, validates UUID/run inputs,
and can only match `user_agent LIKE 'HYC-E2E/%'`. Exact-SID cleanup is used by
fixtures and the live smoke test. Run/stale cleanup only removes marked rows
that are revoked, expired or older than the explicit stale threshold. A test
that throws still reaches `finally`; parallel tests delete only their own SID,
so an active sibling Session remains usable. Tests prove that an ordinary
non-E2E SID is preserved and that production execution is refused.

The live smoke script uses the same marker, formal logout and exact cleanup.
Its final verification passed login, bounded/model-limited token creation,
real non-streaming relay, real SSE, two consumption logs and quota decrement,
then returned the database to the exact starting state.

## Verification record

- Targeted i18n/unit helpers: 4/4 pass.
- Frontend unit tests: 111/111 pass across 26 files.
- Typecheck: pass.
- Lint guard: pass at 447; baseline unchanged.
- Frontend production build: pass.
- `go build ./...`: pass.
- Required Go packages (`controller`, `service`, `model`, `common`): pass. An
  old service cache-stat test used the clock as an isolation key while another
  test froze time; it now uses `t.Name()` and the full set is order-independent.
  No Phase 4.7 backend production code was changed.
- Development and production Compose config rendering: pass.
- Development health: Postgres, Redis and API all green.
- Full Playwright mock suite: 88 pass, 8 live-only skips.
- Full Playwright live suite: 96/96 pass.
- Authentication durability: five consecutive 2-worker rounds, 5/5 tests per
  round, no 409; after every round Session counts were unchanged at
  `total=1, active=1, issued_24h=1, E2E=0`. The smoke test started and ended at
  the same values without deleting that ordinary Session record.

The browser matrix covers `/`, `/pricing`, `/sign-in`, `/sign-up`, `/404`,
`/dashboard/overview`, `/keys` and `/usage-logs/common`; en/zhCN; light/dark;
and 390×844, 768×1024 and 1440×900. Representative evidence is in
`artifacts/phase4-7/`.

## Rule for Phase 5

Phase 5 must continue to use the existing locale resources and `t()` calls,
`newAppPage` for truthful theme/locale state, and `withRootSession` for every
authenticated browser test. It must never restore global Session-table
clearing or hand-write login cleanup.
