# Reference audit — seekgt.com

Audited: 2026-07-28. Method: unauthenticated HTTP against public endpoints only.
No login was attempted, no protected content was accessed, and no assets were
downloaded.

## Headline finding

**seekgt.com is a stock New API deployment — the same upstream project this
product is built on, one release line behind.**

This was not an assumption. It is what the site reports about itself:

| Evidence | Source | Value |
|---|---|---|
| Page title | `GET /` HTML | `New API` |
| Meta description | `GET /` HTML | `Unified AI API gateway and admin dashboard.` |
| Embedded comments | `GET /` HTML | `<!--Umami QuantumNous-->`, `<!--Google Analytics QuantumNous-->` |
| Bundle names | `GET /` HTML | `vendor-tanstack.*.js`, `lib-react.*.js`, `index.*.js` (New API Rsbuild output) |
| Reported version | `GET /api/status` | `v1.0.0-rc.15` |
| Configured site name | `GET /api/status` | `卡比兽 API` |
| Custom logo | `GET /api/status` | *(empty)* |
| Custom footer HTML | `GET /api/status` | *(empty)* |
| Quota per unit | `GET /api/status` | `500000` (upstream default) |

The homepage is a client-rendered SPA: `GET /` returns 1,080 bytes containing
only `<div id="root">`. There is no server-rendered marketing content to audit.

### What this means for the product

1. **There is no proprietary information architecture to reverse-engineer.**
   The IA is upstream New API's, and this repository contains that frontend in
   full source form. `docs/page-matrix.md` is therefore derived from
   `web/src/routes/` — authoritative — rather than guessed from a rendered DOM.

2. **The reference site's customization is one configuration field.** It sets
   the `SystemName` option to `卡比兽 API` and changes nothing else. The browser
   tab still reads "New API" because the title is baked into `web/index.html`,
   which they did not modify. Logo and footer are unset.

3. **The competitive bar is lower than the brief assumed.** The brief asked to
   reach "the same level of product completeness". We start from a *newer*
   upstream (rc.22 vs rc.15), so feature parity is already met or exceeded on
   day one. The differentiator is not features — it is the brand system,
   design system, and pricing/catalogue presentation.

4. **Copying is both unnecessary and legally pointless here.** Their visible
   layout is upstream's AGPL frontend, which we already have licensed. The only
   things that would be theirs to take are the name "卡比兽 API" and their
   pricing numbers — neither of which we want.

## Version delta: rc.15 → rc.22 (our baseline)

Our pinned baseline is seven releases ahead. Schema-visible additions observed
when migrating a clean database (see `docs/migration-plan.md`): `auth_flows`,
`external_identity_claims`, `user_sessions` — i.e. the reworked session and
external-identity handling that rc.15 does not have.

## Information architecture actually in use

Confirmed present in the rc.22 source we build from, and therefore present in
some form on the reference site. Full detail in `docs/page-matrix.md`.

- **Public**: landing, pricing (list + per-model detail), model rankings,
  about, privacy policy, user agreement
- **Auth**: sign-in, sign-up/register, forgot-password, reset, OTP, OAuth
  callback
- **User console**: dashboard, API keys, usage logs, wallet, subscriptions,
  profile, playground, model catalogue, chat
- **Admin**: channels, users, redemption codes, system settings (site, auth,
  billing, models, operations, content, security), system info
- **Errors**: 401, 403, 404, 500, 503

## What was NOT audited, and why

- **Authenticated console screens.** Auditing them would require creating an
  account on a third party's production service. Not done. It is also
  unnecessary: those screens are the upstream code in this repository.
- **Dark/light behaviour, responsive breakpoints, animation.** These require a
  rendering browser. No reliable browser automation was connected in this
  session, so no claim is made about them. Since the frontend is stock
  upstream, its theming is `next-themes` + Tailwind as shipped — inspectable
  directly in `web/src/`.
- **Their pricing figures.** Deliberately not copied. Pricing is a commercial
  decision (see `docs/adr/0005-provisional-model-pricing.md`).

## Brand and asset boundary

Do not reuse: the name `卡比兽 API`, their `/logo.png`, their favicon, or their
pricing table. Nothing from the site was downloaded during this audit.

Upstream attribution is a separate, mandatory obligation and is unaffected by
branding — see `docs/adr/0002-agpl-attribution-obligations.md`.
