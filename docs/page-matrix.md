# Page matrix

Derived from `web/src/routes/` at upstream baseline v1.0.0-rc.22
(commit `bc14c18f6024e79cba1c08d02cd007796e12d668`). This is the authoritative
route list — it is read from the router source, not inferred from a rendered
page.

TanStack Router file conventions used below:

- `(group)` — pathless layout group, contributes no URL segment
- `_authenticated` — pathless auth-guard layout
- `$param` — dynamic segment

Priority column follows the ordering in the product brief: **P1** is the first
redesign wave (navigation, public site, auth, core console), **P2** is the
remaining user surface, **P3** is admin (optimise for density and diagnosis,
not visual polish).

## Public / unauthenticated

| Route               | Source                       | Purpose                                                     | Priority |
| ------------------- | ---------------------------- | ----------------------------------------------------------- | -------- |
| `/`                 | `index.tsx`                  | Landing page                                                | **P1**   |
| `/pricing`          | `pricing/index.tsx`          | Model catalogue and pricing                                 | **P1**   |
| `/pricing/$modelId` | `pricing/$modelId/index.tsx` | Per-model pricing detail                                    | **P1**   |
| `/model-catalog`    | `model-catalog/index.tsx`    | API-backed product model catalogue                          | **P1**   |
| `/leaderboard`      | `leaderboard/index.tsx`      | Model usage leaderboard — **canonical**                     | P2       |
| `/rankings`         | `rankings/index.tsx`         | Compatibility redirect to `/leaderboard`, forwards search   | P2       |
| `/about`            | `about/index.tsx`            | About page — **carries the mandatory upstream attribution** | **P1**   |
| `/privacy-policy`   | `privacy-policy.tsx`         | Privacy policy                                              | P2       |
| `/user-agreement`   | `user-agreement.tsx`         | Terms of service                                            | P2       |
| `/setup`            | `setup/index.tsx`            | First-run initialisation wizard                             | P3       |

### Alignment coverage

Which public routes have been through the seekgt alignment work and captured as
evidence. "Captured" means a screenshot exists under `artifacts/` with a
measured overflow result, not that a human approved it.

Round 5 measured every public route across 7 viewports (390 / 768 / 820 / 1024
/ 1280 / 1440 / 1920) × light+dark × zhCN+en — **224 rows**. All report no
horizontal overflow, no heading overflowing its own box, no devtools overlay,
no stray floating widget, correct theme and HTTP 200. Full results:
`artifacts/phase-ui-seekgt-round5/capture-manifest.json`.

| Route            | Aligned                                 | Direct entry verified |
| ---------------- | --------------------------------------- | --------------------- |
| `/`              | rounds 1, 2, 4, 5 (headings, rhythm)    | yes                   |
| `/pricing`       | rounds 2, 4, 5 (two-card grid)          | yes                   |
| `/model-catalog` | rounds 1, 2, 4, 5 (shared result grid)  | yes                   |
| `/leaderboard`   | rounds 4, 5 — **was 404 before round 4**| yes                   |
| `/rankings`      | round 4 — redirect only                 | yes                   |
| `/about`         | rounds 1, 4, 5 (masthead rhythm)        | yes                   |
| `/sign-in`       | rounds 2, 4, 5 (tablet layout)          | yes                   |
| `/sign-up`       | rounds 2, 4, 5 (tablet layout)          | yes                   |

Not yet visually revisited: `/pricing/$modelId`, `/privacy-policy`,
`/user-agreement`, `/setup`, and every auth route other than sign-in and
sign-up. They inherit the shared layout and tokens, so they are not broken —
they are simply unverified.

**Direct entry is now part of the contract.** `/leaderboard` returned 404 for
three rounds because every test reached the page by clicking the header link.
`e2e/phase-ui-round4-routing.e2e.ts` navigates by URL only, and asserts reload
and the header's `href`. Add new public routes to `PUBLIC_ROUTES` there.

## Authentication

Grouped under the pathless `(auth)` layout (`(auth)/route.tsx`).

| Route              | Source                       | Purpose                    | Priority |
| ------------------ | ---------------------------- | -------------------------- | -------- |
| `/sign-in`         | `(auth)/sign-in.tsx`         | Login                      | **P1**   |
| `/sign-up`         | `(auth)/sign-up.tsx`         | Registration               | **P1**   |
| `/register`        | `(auth)/register.tsx`        | Registration entry variant | **P1**   |
| `/forgot-password` | `(auth)/forgot-password.tsx` | Password reset request     | P2       |
| `/reset`           | `(auth)/reset.tsx`           | Password reset completion  | P2       |
| `/user/reset`      | `(auth)/user/reset.tsx`      | User-scoped reset          | P2       |
| `/otp`             | `(auth)/otp.tsx`             | Two-factor / OTP challenge | P2       |
| `/oauth`           | `(auth)/oauth.tsx`           | OAuth entry                | P2       |
| `/oauth/$provider` | `oauth/$provider.tsx`        | OAuth provider callback    | P2       |

## User console

Guarded by `_authenticated/route.tsx`.

| Route                  | Source                                     | Purpose                                                            | Priority          |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ----------------- |
| `/dashboard`           | `_authenticated/dashboard/index.tsx`       | Usage overview                                                     | **P1**            |
| `/dashboard/$section`  | `_authenticated/dashboard/$section.tsx`    | Dashboard sub-views                                                | **P1**            |
| `/keys`                | `_authenticated/keys/index.tsx`            | **API token management**                                           | **P1**            |
| `/usage-logs`          | `_authenticated/usage-logs/index.tsx`      | **Call logs**                                                      | **P1**            |
| `/usage-logs/$section` | `_authenticated/usage-logs/$section.tsx`   | Log sub-views                                                      | **P1**            |
| `/wallet`              | `_authenticated/wallet/index.tsx`          | **Live ledger, usage/funding history and capability-gated top-up** | **P1**            |
| `/profile`             | `_authenticated/profile/index.tsx`         | **Identity, login methods and owned-Session security**             | **P1**            |
| `/models`              | `_authenticated/models/index.tsx`          | Available model catalogue                                          | P2                |
| `/models/$section`     | `_authenticated/models/$section.tsx`       | Model sub-views                                                    | P2                |
| `/playground`          | `_authenticated/playground/index.tsx`      | In-browser API testing                                             | P2                |
| `/my-subscription`     | `_authenticated/my-subscription/index.tsx` | User plan, entitlement and lifecycle console                       | Phase 5C complete |
| `/subscriptions`       | `_authenticated/subscriptions/index.tsx`   | Admin plans and lifecycle diagnostics                              | Phase 5C complete |
| `/chat/$chatId`        | `_authenticated/chat/$chatId.tsx`          | Chat interface                                                     | P2                |
| `/chat2link`           | `_authenticated/chat2link.tsx`             | External chat client hand-off                                      | P2                |
| `/errors/$error`       | `_authenticated/errors/$error.tsx`         | In-console error surface                                           | P2                |

Phase 5B keeps Wallet and Profile inside the shared authenticated shell.
`/wallet` reads the existing user/log/top-up truths and never owns a second
balance. `/profile` edits only supported self fields and reuses existing
password, OAuth, Passkey and browser-Session APIs. There is no separate
Security route; Session management is an explicit Profile section.

## Admin

Same auth layout; gated to admin roles by the backend.

| Route                         | Source                                      | Purpose                                                           | Priority |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------------------- | -------- |
| `/channels`                   | `_authenticated/channels/index.tsx`         | Upstream channel management — **holds provider keys and routing** | P3       |
| `/users`                      | `_authenticated/users/index.tsx`            | User administration                                               | P3       |
| `/redemption-codes`           | `_authenticated/redemption-codes/index.tsx` | Redemption code management                                        | P3       |
| `/system-info`                | `_authenticated/system-info/index.tsx`      | System diagnostics                                                | P3       |
| `/system-settings`            | `_authenticated/system-settings/index.tsx`  | Settings root                                                     | P3       |
| `/system-settings/site`       | `.../site/index.tsx`, `$section.tsx`        | Site identity — **brand configuration lives here**                | P3       |
| `/system-settings/auth`       | `.../auth/index.tsx`, `$section.tsx`        | Auth and OAuth providers                                          | P3       |
| `/system-settings/billing`    | `.../billing/index.tsx`, `$section.tsx`     | Billing configuration                                             | P3       |
| `/system-settings/models`     | `.../models/index.tsx`, `$section.tsx`      | **Model pricing and ratios**                                      | P3       |
| `/system-settings/operations` | `.../operations/index.tsx`, `$section.tsx`  | Operational toggles                                               | P3       |
| `/system-settings/content`    | `.../content/index.tsx`, `$section.tsx`     | Announcements, FAQ, content                                       | P3       |
| `/system-settings/security`   | `.../security/index.tsx`, `$section.tsx`    | Rate limits, security policy                                      | P3       |

`/models/catalog` is the administrator-facing product catalog tab inside the
existing authenticated Models route. Backend `AdminAuth`, not route location,
is the authority boundary.

## Error pages

| Route  | Source             | Priority |
| ------ | ------------------ | -------- |
| `/401` | `(errors)/401.tsx` | P2       |
| `/403` | `(errors)/403.tsx` | P2       |
| `/404` | `(errors)/404.tsx` | P2       |
| `/500` | `(errors)/500.tsx` | P2       |
| `/503` | `(errors)/503.tsx` | P2       |

## Coverage against the brief

Every page named in the brief's redesign priority list already exists upstream.
Phase 4/5 is a **design-system and brand pass over existing routes**, not
greenfield page construction:

| Brief item                      | Existing route                                               |
| ------------------------------- | ------------------------------------------------------------ |
| 1. Global navigation and layout | `__root.tsx`, `_authenticated/route.tsx`, `(auth)/route.tsx` |
| 2. Public landing               | `/`                                                          |
| 3. Pricing                      | `/pricing`, `/pricing/$modelId`                              |
| 4. Login                        | `/sign-in`                                                   |
| 5. Register                     | `/sign-up`, `/register`                                      |
| 6. Dashboard                    | `/dashboard`                                                 |
| 7. Token management             | `/keys`                                                      |
| 8. Call logs                    | `/usage-logs`                                                |
| 9. Balance / top-up             | `/wallet`                                                    |
| 10. Personal settings           | `/profile`                                                   |

Gaps to add rather than restyle:

- **Status page** — no route exists. Upstream exposes an Uptime Kuma URL option
  (`UptimeKumaUrl`, `UptimeKumaSlug`) rather than a first-party page.
- **API quickstart / integration guide** — no dedicated route; guidance is
  currently embedded in `/keys` and `/playground`.

## Phase 4 implementation coverage

| Surface                                                   | Phase 4 state                    | Validation                                          |
| --------------------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| Global public shell, header, mobile navigation and footer | Complete                         | 390, 768 and 1440 px browser checks; light/dark     |
| Landing page `/`                                          | Complete                         | Desktop light and mobile dark screenshots           |
| Pricing `/pricing`                                        | Complete                         | Live `GET /api/pricing`; provisional status visible |
| Sign in `/sign-in`                                        | Complete                         | Error credentials and successful redirect           |
| Sign up `/sign-up`, `/register`                           | Complete                         | Enabled flow plus mocked disabled state             |
| Authenticated shell and dashboard                         | Complete                         | `/dashboard/overview`                               |
| Core business surfaces                                    | Complete shell pass              | `/keys`, `/usage-logs/common`                       |
| Error surfaces                                            | Complete                         | 401, 403, 404, 500 and 503 share recovery layout    |
| Admin and remaining P2/P3 feature interiors               | Existing design system inherited | Deferred to Phase 5 page-level work                 |

Phase 4 does not add a first-party status or quickstart route. The landing page
now provides a verified request example and the existing dashboard setup guide
remains the authenticated quickstart surface.

## Phase 4.5 independent acceptance (2026-07-29)

Re-verified against a running system rather than inherited from the Phase 4
report. Full record: `docs/phase4-5-acceptance.md`.

| Surface                                              | Verified | Method                                                                       |
| ---------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `/`, `/pricing`, `/sign-in`, `/sign-up`              | Pass     | Overflow at 390/768/1280/1440/1920; light+dark; en+zhCN                      |
| `/login`, `/register`                                | Pass     | Redirect to `/sign-in` / `/sign-up`                                          |
| `/about`, `/privacy-policy`, `/user-agreement`       | Pass     | Direct navigation **and** reload                                             |
| Unknown route                                        | Pass     | Productised 404 with recovery links and brand                                |
| `/dashboard/overview`, `/keys`, `/usage-logs/common` | Pass     | Brand, no auth bounce, no double scrollbar, reload-safe                      |
| Footer legal surface                                 | Pass     | Attribution, upstream link, no fabricated source URL                         |
| Pricing data source                                  | Pass     | Every `GET /api/pricing` model asserted in DOM; no upstream model name leaks |

Two presentation defects were found and fixed in this pass: the footer exposed
`SOURCE_CODE_URL` deployment state as an amber warning, and `/pricing`
truncated the model identifier. Remaining gaps are content, not routing —
model descriptions are still empty (P2-1), and the status and quickstart routes
remain unbuilt.

## Phase 4.7 i18n and Session-safe coverage (2026-07-29)

| Surface                                              | Locale coverage                                                                 | Session behavior                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| `/`, `/pricing`, `/sign-in`, `/sign-up`, `/404`      | en + zhCN, light + dark, persistence/direct navigation, no raw keys or overflow | Public; no Session                             |
| `/dashboard/overview`, `/keys`, `/usage-logs/common` | en + zhCN shell markers at 1440×900, plus inherited Phase 4.6 matrix            | Exact marked SID, logout and `finally` cleanup |
| Footer, legal, support, source and documentation     | Bidirectional copy assertions; HYC AI/New API remain invariant                  | Public; no Session                             |

Representative 390×844, 768×1024 and 1440×900 evidence is stored under
`artifacts/phase4-7/`. Details: `docs/phase4-7-i18n-and-e2e-hygiene.md`.

## Phase 5A model catalog coverage (2026-07-29)

| Surface                  | State                        | Validation                                                                |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------- |
| `/model-catalog`         | Complete, live API           | search/category/capability/status, full ID/copy, loading/error/empty      |
| `/pricing` metadata      | Complete                     | shared identity metadata; prices remain `/api/pricing` truth              |
| `/playground` model data | Minimal integration complete | catalog hook intersects API-enabled and accessible models; no UI redesign |
| `/models/catalog`        | Complete for Phase 5A        | admin CRUD, switches, archive, route/price diagnostics                    |

Catalog matrix covers 390×844, 768×1024 and 1440×900, light/dark, en/zhCN,
2/20/100 models and no horizontal overflow. Full live suite: 115/115.
