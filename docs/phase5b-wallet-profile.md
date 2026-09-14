# Phase 5B — Wallet, profile and authenticated console

Completed and verified on 2026-07-29 from starting commit
`ce2fdad3f935fa59b587d8089c2f4c7f0c3e2ca9`. This phase productizes the
existing account ledger and identity/security capabilities. It does not add a
wallet table, payment provider, subscription product or new billing rule.

## Wallet truth and presentation

The existing `users` row is the Wallet summary truth: `quota` is current
account credit, `used_quota` is cumulative settled consumption and
`request_count` is the cumulative request count. The existing self endpoints
provide those values; `logs` provide consumption history and `top_ups` provide
funding history. No frontend total is independently persisted.

`/wallet` now presents the single account-credit/remaining-quota value, total
usage, total API requests and today's usage/request count. It explicitly
explains that the backend has one available-credit ledger value, rather than
duplicating it as two independent financial metrics. Recent consumption links
to usage logs; recent top-ups link to billing history. The page refreshes live
sources on focus/visibility and after successful redemption, transfer or
payment actions.

All amounts use the existing `formatQuota` and system-currency configuration.
Internal integer quota is not rendered directly as a customer amount. The
implementation performs no new floating-point billing arithmetic. Loading is
skeletal, a failed first read hides the summary instead of showing zero, a
failed refresh labels retained data as stale, and partial activity failures
use an em dash/unavailable state rather than a fabricated zero.

## Top-up and redemption boundary

The page renders only capabilities reported by `GET /api/user/topup/info`:
configured online methods, external top-up link and/or redemption. When online
top-up is disabled the UI says so. When compliance confirmation disables
redemption or referral transfer, the UI says so and does not offer a bypass.
The provisional pricing notice remains visible and the UI makes no savings or
promotion claim.

No payment provider was added. Existing payment callbacks, idempotency,
permission checks and row locking remain authoritative. Existing model tests
prove a code credits quota exactly once, repeat use fails without a second
credit and five concurrent attempts produce exactly one success.

## Profile fields

`/profile` has an explicit basic-profile card. Username, email, user group,
account status and creation time are read-only. Display name is the supported
editable identity field, required, trimmed and limited to 20 characters. The avatar is
deterministically generated from account identity; custom avatar upload is not
supported and is not implied.

`GET /api/user/self` now returns `created_at` and the compatibility
`created_time`. A successful profile refresh synchronizes the authenticated
Zustand user, so the profile header and global profile menu update together.
The self-update controller allow-lists only `display_name`, `password` and
`original_password`; username and every authorization, billing or account-state
field are rejected server-side. After a successful display-name write, the
confirmed value is synchronized into both profile and authenticated-shell
state; a failed reconciliation read remains visibly marked. Fetch errors
preserve an honest error/retry state rather than constructing a synthetic
profile.

## Password and login methods

Password changes continue through `PUT /api/user/self`. Existing policy is
unchanged: the current password is required, the model validator enforces an
8–20 character new password, the browser form requires confirmation, exposes
accessible show/hide controls and uses password autocomplete semantics. A
successful change advances the current Session and user auth version; stale
access credentials no longer authenticate. Passwords are not placed in URLs,
logs, evidence or committed fixtures.

OAuth binding and unbinding continue through existing provider-specific flows
and `/api/user/oauth/bindings`; provider availability comes from system status.
Passkey registration/status/reset continue through the existing WebAuthn
controllers. Phase 5B only integrates these established cards into the
profile/security surface; it does not synthesize a provider or weaken proof,
origin, role or Session checks.

## Session self-service and privacy

The profile lists only the authenticated user's browser Sessions via
`GET /api/user/sessions`. It shows current-device state, login method, signed-in
time, last activity and expiry. Stored user agents are reduced to a generic
device/browser label. IP presentation is privacy-preserving: IPv4 drops the
last octet, IPv6 keeps only the first four groups, and unparseable input is
hidden.

Supported actions are:

- `DELETE /api/user/sessions/:sid` — revoke one owned Session;
- `POST /api/user/sessions/revoke-others` — revoke all except current;
- `POST /api/user/sessions/revoke-all` — revoke every owned Session, clear the
  refresh cookie and return to sign-in.

These routes require a real browser Session; PAT authentication is
insufficient. Model queries always include the authenticated user ID, so a SID
cannot be used to revoke another user's Session. Current-device and revoke-all
actions clearly warn that the browser will be signed out. The production
Session limits and the Session-safe E2E fixture were not changed.

## Permissions

The backend remains the authority. Self routes derive the user ID from
authentication and do not accept a target user ID. Ordinary users cannot set
their role, group, quota, used quota, status or read another user's self data.
Admin user APIs retain role checks. Payment and redemption controls retain
their existing compliance and idempotency gates. OAuth, Passkey, password and
Session mutations retain their existing proof/Session requirements.

## Verification

- Real relay smoke passed: one non-streaming call, one SSE call with six
  incremental chunks and `[DONE]`, two consumption logs, token quota
  `500000→499986`, and user Wallet `quota -14`, `used_quota +14`, requests `+2`.
- A model outside the Token allow-list returned 403 and left all three Wallet
  ledger fields unchanged.
- Real root Profile edit saved, updated the profile menu, survived reload and
  was restored to its original value.
- A temporary user proved wrong-current-password rejection, successful change,
  old-password rejection and new-password login; it was then hard-deleted.
- A second real root Session was created, observed in the owned list, revoked
  by exact SID, confirmed absent and cleaned by the Session-safe fixture.
- Playwright Phase 5B mock coverage includes profile save/menu/reload, Wallet
  source failure truthfulness, revoke-all redirect and the 12-case responsive
  locale/theme matrix. The live case covers Wallet, Profile, edit persistence
  and Session lifecycle.
- Complete Playwright mock run: 121 passed, 11 live-only skipped. Complete live
  run with four workers: 132/132 passed. The Phase 5B live case also passed in
  consecutive isolated runs, leaving zero `HYC-E2E/%` Session rows.
- Go tests include Session ownership/revoke-all, IP masking, password policy,
  OAuth/Passkey authorization, redemption repeat/concurrency, user update
  field boundaries and payment-provider guards.
- Typecheck and all 114 frontend unit tests passed. Related Go tests, vet and
  `go build ./...` passed. Frontend production build passed. Lint remains the
  inherited 447-violation baseline with no new debt. Development Compose and
  production Compose syntax (with in-memory validation values only) passed;
  real production interpolation remains intentionally gated.

Evidence screenshots are stored under `artifacts/phase5b/`.

## Known limits and blockers

Online top-up is not configured in the verified development environment and
redemption/referral transfer remain disabled until compliance confirmation.
No real OAuth provider binding or physical Passkey enrollment was performed;
their backend permission/proof paths and live disabled-state presentation were
verified. The three pre-existing launch blockers remain: `SOURCE_CODE_URL` is
unset, `PRICING_STATUS` is provisional and nginx has not passed `nginx -t` in a
usable production environment.
