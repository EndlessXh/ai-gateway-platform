# Phase 4.6 — browser test truthfulness repair

Starting commit `9d3bf78f0224784ad8430171e1de186becf17d61`. Scope: repair false
theme/locale coverage in the browser tests and establish a trustworthy basis.
No product functionality or visual design was changed.

## 1. What the old tests actually assumed

| Assumption | Reality | Consequence |
|---|---|---|
| Theme lives in `localStorage` | It is a **cookie**, `vite-ui-theme` (`web/src/context/theme-provider.tsx`) | The Phase 4.5 helper set localStorage, so the cookie was never written |
| Missing theme state means `light` | Default is **`system`**, which follows `prefers-color-scheme` | With Playwright's default `colorScheme: light`, *both* the light and dark runs rendered light |
| An invalid cookie fails loudly | An invalid value silently falls back to `system` | Measured: `cookie="BOGUS"` + `colorScheme=dark` still renders `html.dark` |
| "Chinese characters present" proves zhCN | Whichever locale is the context default satisfies it | One-directional check passes even when injection is a complete no-op |
| `zh` is the wrong locale code | `zh` **does** map to `zhCN` via `convertDetectedLanguage` | My own Phase 4.5 claim was wrong; the real defect was asserting the default direction |
| Phase 4 covered light/dark and en/zh | `phase4-runtime.e2e.ts` and `phase4-live-runtime.e2e.ts` contain **no theme or locale injection at all** | That coverage never existed |

### The subtlety that matters most

Which locale is "the default" is **not a property of the machine** — it is a
property of the browser context:

- a bare `browser.newContext()` inherits the OS locale, which is `zh-Hans-HK`
  here, so the app renders **Chinese** with no injection;
- the project preset `devices['Desktop Chrome']` pins `locale: en-US`, so
  inside the test runner the app renders **English** with no injection.

So the unsafe direction flips depending on `playwright.config.ts`. Neither
direction can be trusted alone. This is now asserted as a meta-test.

## 2. Conclusions the old tests could not support

- **"Dark mode verified"** (Phase 4 validation, Phase 4.5 acceptance) — the
  Phase 4.5 run rendered light in both cases before the mid-audit fix, and
  Phase 4 never set a theme at all.
- **"Chinese verified"** — the check only asserted Chinese characters were
  present, which the context default already satisfied.
- **"Dark is a designed palette, not an inversion"** — the pure-black/white
  check ran, but against a light page.

The *other* Phase 4.5 findings (branding, routing, pricing source, footer,
port topology, overflow) were asserted correctly and are unaffected.

## 3. What was changed

New shared helper: **`web/e2e/helpers/app-state.ts`**. All browser tests now go
through it; hand-rolled state injection is no longer permitted.

**Theme** — `newAppPage(browser, { theme })`:
- writes the real cookie `vite-ui-theme` before any app code runs;
- **pins `colorScheme` to the opposite colour**, so the requested theme can
  only be reached through a correctly-read cookie, never through the `system`
  fallback;
- `assertThemeApplied` checks the `dark`/`light` class the provider sets *and*
  that computed background luminance actually matches, so a class that no
  longer drives styling cannot pass;
- still asserts dark is not pure black on pure white.

**Locale** — `newAppPage(browser, { locale })`:
- writes `i18nextLng` with the codes the app really uses (`en`, `zhCN`);
  unsupported codes throw rather than silently falling back;
- `assertLocaleApplied` requires the expected locale's marker **present** and
  the opposite locale's marker **absent**;
- `assertLocalesDiffer` requires en and zhCN to render different text.

Markers were measured, not guessed:

| Surface | en | zhCN |
|---|---|---|
| public (`/`, `/pricing`, `/sign-in`, `/sign-up`) | `Toggle theme`, `Pricing`, `About` | `切换主题`, `定价`, `关于` |
| console (`/dashboard/overview`, `/keys`, `/usage-logs/common`) | `Wallet`, `Profile`, `Usage Logs` | `钱包`, `日志` |

Two further helper bugs were found and fixed while doing this:

- **Colour parsing.** Chrome reports this project's Tailwind v4 colours as
  `lab()` on public pages but `oklch()` in the console. Parsing either as rgb
  produced a nonsense luminance. Now normalised per colour space.
- **`<footer>` collision.** The TanStack Router devtools panel also renders a
  `<footer>`, making a bare `locator('footer')` a strict-mode violation.
  `productFooter()` excludes it.

## 4. Reverse-failure verification

Each defence was proven to fail when deliberately broken, then reverted.

**Theme sabotage** — helper forced to always write `value: "light"`:

```
5 failed
Error: document should render dark; the theme cookie may not have been read
```

**Locale sabotage** — helper stopped injecting `i18nextLng` entirely:

```
9 failed, 1 passed
Error: expected zhCN text matching /切换主题/; locale was not applied
```

The single test that still passed under sabotage was
*"English must be actively applied"* — because `en` **is** the runner's default
locale, so it renders English even with injection removed. That is precisely
the false-pass mechanism this phase exists to eliminate, demonstrated live, and
it is why the bidirectional marker check is mandatory.

After reverting both sabotages: **32/32** in the truthfulness suite,
**88/88** across all three e2e files.

No sabotage remains in the repository.

## 5. Real defects found while doing this

**Untranslated Phase 4 copy (closed in Phase 4.7).** The hero, feature list,
footer and public product copy were already routed through i18next, but 95
zhCN values still equalled the English source. Phase 4.7 translated those
resources and replaced the former `test.fail()` sentinel with a positive
bidirectional locale assertion.

**A stale Phase 4 test I broke in Phase 4.5.** `phase4-runtime.e2e.ts:99`
asserted the footer shows "Source code URL pending configuration" — the exact
placeholder removed as a P1 defect in Phase 4.5. I changed the footer but only
ran my own suite, so that commit shipped with a broken pre-existing test. The
assertion is now inverted (the placeholder must be absent) and strengthened to
require the attribution line.

**`AUTH_SESSION_LIMIT` mistaken for broken login.** Every logging-in test mints
a session and never logs out, so a few suite runs exhausted
`USER_SESSION_ACTIVE_LIMIT` (default 50). The backend then answers login with
HTTP 409, which presents exactly like bad credentials. `signInAsRoot` now
distinguishes 409 and 429 from a genuine auth failure. Phase 4.7 removed the
unsafe whole-table `resetDevSessions()` workaround: marked E2E Sessions now use
formal logout plus exact-SID cleanup in `finally`. **Neither limit was relaxed**
— both remain production security controls.

## 6. Coverage after the repair

Every combination below asserts the state is genuinely applied, not merely
requested.

| Dimension | Values |
|---|---|
| Public routes | `/`, `/pricing`, `/sign-in`, `/sign-up` |
| Console routes | `/dashboard/overview`, `/keys`, `/usage-logs/common` |
| Error | unknown route → 404 |
| Themes | light, dark (each against the opposing system preference) |
| Locales | en, zhCN (bidirectional markers) |
| Viewports | 390×844, 768×1024, 1440×900 (overflow checked in dark + zhCN, the least-exercised combination) |
| Persistence | reload and direct navigation preserve theme and locale |

Results: **88/88** across `phase4-runtime`, `phase4-5-acceptance` and
`phase4-6-truthfulness`.

## 7. Rule for Phase 5 and later

**Do not hand-roll theme or locale injection.** Use
`newAppPage`, `assertThemeApplied` and `assertLocaleApplied` from
`web/e2e/helpers/app-state.ts`.

Both mechanisms have a silent-failure mode — theme falls back to `system`, and
locale falls back to the context default — so a test that sets state
incorrectly reports success while testing nothing. The helper closes both. If a
new surface needs different markers, add them to `LOCALE_MARKERS` under a new
`Surface` after **measuring** them, rather than weakening an assertion.

## 8. Evidence

`artifacts/phase4-6/` holds only screenshots that demonstrate genuine state:

| File | Proves |
|---|---|
| `sign-in-dark-en-after-reload.png` | dark + English survives a reload |
| `keys-dark-en.png` | console honours the same mechanism |
| `keys-light-zhCN.png` | console genuinely in Chinese, light theme |
| `404-dark-en.png` | error route keeps theme and locale |

Screenshots come from `bun run dev`, so they include the dev-only TanStack
devtools overlay.

## 9. Verification run

| Command | Result |
|---|---|
| `bun run typecheck` | pass |
| `bun run test` | 107/107 pass |
| `bunx playwright test` | **88/88 pass** |
| theme sabotage | 5 failed, as required |
| locale sabotage | 9 failed, 1 passed (documented above) |
| `bun run build` | pass |
| `scripts/lint-guard.ps1` | pass, baseline unchanged at 447 |
| `go build ./...` | pass |
| `go test ./model/ ./setting/platform/ ./controller/` | pass |
| dev + prod `compose config` | pass |

`new-api-infra` was not modified.

## 10. Phase 4.7 closure

Phase 4 product-copy i18n and Session hygiene are now complete. The current
browser total is 96 tests: mock mode passes 88 with 8 live-only skips; live mode
passes 96/96. Five consecutive authenticated durability rounds produced no 409
and no Session accumulation. Full record:
`docs/phase4-7-i18n-and-e2e-hygiene.md`.
