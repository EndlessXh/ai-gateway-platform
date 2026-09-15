/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

/**
 * Shared theme and locale control for browser tests.
 *
 * Phase 5 and later MUST use these helpers rather than injecting state by
 * hand. Two measured facts make hand-rolled injection dangerous, and both
 * previously produced tests that passed without testing anything:
 *
 * 1. THEME DEFAULTS TO `system`, NOT `light`.
 *    web/src/context/theme-provider.tsx stores the theme in the cookie
 *    `vite-ui-theme` and validates it against {dark, light, system}; anything
 *    missing or invalid falls back to `system`, which follows
 *    prefers-color-scheme. Measured: cookie="BOGUS" + colorScheme=dark still
 *    renders `html.dark`. So if a test sets the cookie incorrectly but pins
 *    colorScheme to the colour it wants, the assertion passes on the fallback
 *    path and proves nothing.
 *    Defence: `applyTheme` pins colorScheme to the OPPOSITE colour, so the
 *    only way to reach the requested theme is a correctly-read cookie.
 *
 * 2. THE DEVELOPMENT MACHINE'S BROWSER LOCALE IS CHINESE (zh-Hans-HK).
 *    i18next detection order is ['localStorage', 'navigator'], so with no
 *    `i18nextLng` the app renders Chinese already. Measured: with no locale
 *    injected at all, the sign-in button reads "登录". An assertion like
 *    "zhCN renders Chinese characters" therefore passes even when injection
 *    is a complete no-op.
 *    Defence: `assertLocaleApplied` checks a locale-specific marker in BOTH
 *    directions, and `assertLocalesDiffer` requires en and zhCN to actually
 *    produce different text.
 *
 * Note: bare `zh` DOES resolve to `zhCN` via convertDetectedLanguage
 * (web/src/i18n/languages.ts). It is still rejected here, because tests should
 * name the code the application actually uses.
 */
import { execFileSync } from 'node:child_process'

import { expect, type Browser, type Page } from '@playwright/test'

export const THEME_COOKIE = 'vite-ui-theme'
export const LOCALE_STORAGE_KEY = 'i18nextLng'
export const APP_ORIGIN = 'http://127.0.0.1:4173'
export const E2E_RUN_ID = (
  process.env.HYC_E2E_RUN_ID ?? `${process.pid}-${Date.now()}`
).replaceAll(/[^A-Za-z0-9_-]/g, '-')
export const E2E_USER_AGENT = `HYC-E2E/${E2E_RUN_ID}/playwright`

export type Theme = 'light' | 'dark' | 'system'
export type Locale = 'en' | 'zhCN'

export type DevSessionCounts = {
  total: number
  active: number
  issued: number
  e2e: number
}

export function devSessionCounts(userAgent?: string): DevSessionCounts {
  if (userAgent && !/^HYC-E2E\/[A-Za-z0-9_/-]+$/.test(userAgent)) {
    throw new Error('Invalid E2E User-Agent marker.')
  }
  const agentClause = userAgent ? `and s.user_agent = '${userAgent}'` : ''
  const output = execFileSync(
    'docker',
    [
      'exec',
      'ai-gateway-dev-postgres-1',
      'sh',
      '-c',
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF '|' -c "select count(*), count(*) filter (where s.status='active' and s.revoked_at=0 and s.expires_at>extract(epoch from now())), count(*) filter (where s.created_at>=extract(epoch from now())-86400), count(*) filter (where s.user_agent like 'HYC-E2E/%') from user_sessions s join users u on u.id=s.user_id where u.username='root' ${agentClause};"`,
    ],
    { encoding: 'utf8' }
  ).trim()
  const [total, active, issued, e2e] = output.split('|').map(Number)
  if ([total, active, issued, e2e].some(Number.isNaN)) {
    throw new Error(`Could not parse development Session counts: ${output}`)
  }
  return { total, active, issued, e2e }
}

export function firstNonTestDevSessionSID(): string | null {
  const output = execFileSync(
    'docker',
    [
      'exec',
      'ai-gateway-dev-postgres-1',
      'sh',
      '-c',
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select sid from user_sessions where coalesce(user_agent, '') not like 'HYC-E2E/%' order by created_at limit 1;"`,
    ],
    { encoding: 'utf8' }
  ).trim()
  return output || null
}

export function devSessionExists(sid: string): boolean {
  if (!/^[0-9a-fA-F-]{36}$/.test(sid)) throw new Error('Invalid Session SID.')
  const output = execFileSync(
    'docker',
    [
      'exec',
      'ai-gateway-dev-postgres-1',
      'sh',
      '-c',
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from user_sessions where sid='${sid}';"`,
    ],
    { encoding: 'utf8' }
  ).trim()
  return output === '1'
}

export function describeLoginFailure(status: number, code: string): string {
  if (status === 401) {
    return `Login credentials invalid (HTTP 401, ${code}).`
  }
  if (status === 409 && code === 'AUTH_SESSION_LIMIT') {
    return 'Login session limit reached (HTTP 409, AUTH_SESSION_LIMIT), not bad credentials.'
  }
  if (status === 409) return `Login conflict (HTTP 409, ${code}).`
  if (status === 429) {
    return 'Login rate limited (HTTP 429), not bad credentials.'
  }
  if (status >= 500) return `Login server error (HTTP ${status}, ${code}).`
  return `Login failed (HTTP ${status}, ${code}).`
}

/** Codes the application actually uses; see web/src/i18n/config.ts. */
const SUPPORTED_LOCALES = new Set<Locale>(['en', 'zhCN'])

/**
 * Locale markers target the INTERACTIVE surface — form labels, buttons and
 * navigation — not marketing copy.
 *
 * That distinction is load-bearing. Measured on 2026-07-29: in zhCN the
 * upstream-derived UI and the Phase 4 product copy now translate together.
 * These shared navigation markers remain useful because they appear on every
 * public route and are mutually exclusive in the two supported locales.
 */
export type Surface = 'public' | 'console'

const LOCALE_MARKERS: Record<
  Surface,
  Record<Locale, { present: RegExp; absent: RegExp }>
> = {
  // Verified mutually exclusive on /, /pricing, /sign-in and /sign-up:
  //   en   -> "Toggle theme", "Pricing", "About"   (no Chinese at all)
  //   zhCN -> "切换主题",      "定价",    "关于"
  public: {
    en: {
      present: /Toggle theme/i,
      absent: /切换主题|定价|关于/,
    },
    zhCN: {
      present: /切换主题/,
      absent: /Toggle theme/i,
    },
  },
  // The console header's theme control is icon-only, so the public markers do
  // not exist there. These are sidebar entries, present on every console route.
  // Verified mutually exclusive on /dashboard/overview, /keys and
  // /usage-logs/common:
  //   en   -> "Wallet", "Profile", "Usage Logs"  (no Chinese at all)
  //   zhCN -> "钱包", "日志"
  console: {
    en: {
      present: /\bWallet\b|\bProfile\b|\bUsage Logs\b/i,
      absent: /[一-鿿]/,
    },
    zhCN: {
      present: /钱包|日志/,
      absent: /\bWallet\b|\bProfile\b|\bUsage Logs\b/i,
    },
  },
}

/**
 * The colour scheme a context must advertise so that the requested theme can
 * ONLY be reached through the cookie. For `system` the scheme is the signal
 * itself, so it is passed through.
 */
export function opposingColorScheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return 'dark'
  return theme === 'dark' ? 'light' : 'dark'
}

/**
 * Creates a page with theme and locale applied before any application code
 * runs. Prefer this over mutating an existing page: the theme cookie is read
 * during the provider's initial state, so setting it late produces a flash or
 * no effect at all.
 */
export async function newAppPage(
  browser: Browser,
  options: {
    theme?: Theme
    locale?: Locale
    viewport?: { width: number; height: number }
    /** Only for `system`: what the OS claims. Ignored otherwise. */
    systemPrefers?: 'light' | 'dark'
    /** Optional per-test marker for database-level Session assertions. */
    sessionTag?: string
  } = {}
): Promise<Page> {
  const theme = options.theme ?? 'light'
  const colorScheme =
    theme === 'system'
      ? (options.systemPrefers ?? 'dark')
      : opposingColorScheme(theme)

  const sessionTag = options.sessionTag?.replaceAll(/[^A-Za-z0-9_-]/g, '-')
  const userAgent = sessionTag
    ? `HYC-E2E/${E2E_RUN_ID}/${sessionTag}`
    : E2E_USER_AGENT
  const context = await browser.newContext({
    colorScheme,
    userAgent,
    viewport: options.viewport ?? { width: 1440, height: 900 },
  })

  await context.addCookies([
    { name: THEME_COOKIE, value: theme, url: APP_ORIGIN },
  ])

  const page = await context.newPage()

  if (options.locale) {
    if (!SUPPORTED_LOCALES.has(options.locale)) {
      throw new Error(
        `Unsupported locale "${options.locale}". Use 'en' or 'zhCN' — the codes in web/src/i18n/config.ts.`
      )
    }
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value)
      },
      [LOCALE_STORAGE_KEY, options.locale] as const
    )
  }

  return page
}

/** The theme the document is actually rendering, read from the DOM. */
export async function resolvedTheme(page: Page): Promise<'light' | 'dark'> {
  return page.evaluate(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )
}

/**
 * Asserts the requested theme is genuinely applied — the `dark`/`light` class
 * the provider sets, plus a real change in computed background colour so a
 * class that no longer drives any styling cannot pass.
 */
export async function assertThemeApplied(
  page: Page,
  expected: 'light' | 'dark'
) {
  const actual = await resolvedTheme(page)
  expect(
    actual,
    `document should render ${expected}; the theme cookie may not have been read`
  ).toBe(expected)

  const { bg, fg } = await page.evaluate(() => {
    const s = getComputedStyle(document.body)
    return { bg: s.backgroundColor, fg: s.color }
  })

  // Chrome reports this project's Tailwind v4 colours in several spaces
  // depending on the surface: the public pages resolve to `lab()` while the
  // console resolves to `oklch()`. Both carry lightness in their first
  // component, but on different scales, and parsing either as rgb yields a
  // nonsense value that silently fails the assertion. Normalise to 0-1.
  const bgLuminance = await page.evaluate(() => {
    const s = getComputedStyle(document.body).backgroundColor
    const m = s.match(/[\d.]+/g)
    if (!m) return null
    if (s.startsWith('oklch') || s.startsWith('oklab')) {
      return Number(m[0]) // already 0-1
    }
    if (s.startsWith('lab') || s.startsWith('lch')) {
      return Number(m[0]) / 100
    }
    if (s.startsWith('rgb')) {
      const [r, g, b] = m.map(Number)
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    }
    return null // unknown space: skip rather than assert on a guess
  })

  expect(bg, 'body background must be resolved').not.toBe('')
  if (bgLuminance !== null) {
    if (expected === 'dark') {
      expect(
        bgLuminance,
        `dark background should be dark, got ${bg}`
      ).toBeLessThan(0.5)
    } else {
      expect(
        bgLuminance,
        `light background should be light, got ${bg}`
      ).toBeGreaterThan(0.5)
    }
  }

  // A designed palette, not an inversion.
  if (expected === 'dark') {
    expect(bg, 'dark background should not be pure black').not.toBe(
      'rgb(0, 0, 0)'
    )
    expect(fg, 'dark foreground should not be pure white').not.toBe(
      'rgb(255, 255, 255)'
    )
  }
}

/**
 * Asserts the requested locale is genuinely applied.
 *
 * Checks the marker for the requested locale is PRESENT and the opposite
 * locale's marker is ABSENT. The positive half alone is never sufficient:
 * whichever locale happens to be the context default will satisfy it even if
 * injection did nothing, and which locale that is depends on
 * playwright.config.ts (see the meta-test in phase4-6-truthfulness.e2e.ts).
 */
export async function assertLocaleApplied(
  page: Page,
  expected: Locale,
  surface: Surface = 'public'
) {
  const marker = LOCALE_MARKERS[surface][expected]

  /*
    Poll for the marker rather than taking one instantaneous snapshot.

    i18next applies the locale after hydration, so a single `innerText()` read
    immediately after navigation can land on the untranslated frame. That made
    this helper fail intermittently while the page snapshot in the failure
    artifact clearly showed the correct language — the assertion was simply
    early. Polling does not weaken the check: the marker must still appear.
  */
  await expect
    .poll(
      async () => marker.present.test(await page.locator('body').innerText()),
      {
        message: `expected ${expected} text matching ${marker.present}; locale was not applied`,
      }
    )
    .toBe(true)

  // Read once more, now that the page has settled, so the "no other language"
  // check cannot pass on a half-translated frame either.
  const text = await page.locator('body').innerText()
  expect(
    marker.absent.test(text),
    `found ${expected === 'en' ? 'Chinese' : 'English'} text that should not appear in ${expected}; the page is only partially translated`
  ).toBe(false)
}

/**
 * Proves the locale switch does something, by requiring the two locales to
 * render different text for the same route. Guards against a machine default
 * masking a broken switch.
 */
export function assertLocalesDiffer(
  enText: string,
  zhText: string,
  route: string
) {
  expect(
    enText === zhText,
    `${route} rendered identical text in en and zhCN; the locale switch is not working`
  ).toBe(false)
}

/** Untranslated i18next keys usually surface as the raw dotted key. */
export async function findRawI18nKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const matches = document.body.innerText.match(
      /\b[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*){2,}\b/g
    )
    if (!matches) {
      return []
    }
    return [
      ...new Set(
        matches.filter(
          (m) =>
            !m.includes('.com') &&
            !m.includes('.org') &&
            !m.includes('.io') &&
            !m.includes('.js') &&
            !m.includes('.ts') &&
            !m.endsWith('.svg') &&
            !m.endsWith('.png')
        )
      ),
    ]
  })
}

/**
 * Detects a genuine double scrollbar.
 *
 * The defect is not "more than one scrollable element" — an app shell is
 * supposed to have exactly one scrolling content region while the document
 * stays fixed. The defect is the document scrolling AND an inner container
 * scrolling at once, giving two competing scrollbars.
 *
 * Dev-only TanStack devtools inject their own scrollable panels (goober
 * `go<hash>` class names) on every route and are excluded; they are stripped
 * from production builds.
 */
export async function detectDoubleScrollbar(page: Page): Promise<{
  documentScrolls: boolean
  inner: string[]
}> {
  return page.evaluate(() => {
    const doc = document.documentElement
    const documentScrolls = doc.scrollHeight > doc.clientHeight + 1

    const inner: string[] = []
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      const scrolls = s.overflowY === 'auto' || s.overflowY === 'scroll'
      if (!scrolls || el.scrollHeight <= el.clientHeight + 4) continue

      const cls = (el.className || '').toString()
      const isDevtools =
        /\bgo\d{6,}\b/.test(cls) ||
        el.closest(
          '[data-tanstack-router-devtools], .tsqd-parent-container'
        ) !== null
      if (isDevtools) continue

      inner.push(`${el.tagName.toLowerCase()}.${cls.split(' ')[0]}`)
    }

    return { documentScrolls, inner }
  })
}

/**
 * The product footer, excluding the dev-only TanStack Router devtools panel,
 * which also renders a `<footer>` and makes a bare `locator('footer')` a
 * strict-mode violation.
 */
export function productFooter(page: Page) {
  return page.locator('footer').filter({ hasNotText: 'TanStack' }).first()
}

/**
 * Clears the DEVELOPMENT rate-limit counters.
 *
 * A full browser suite makes hundreds of requests and trips both the global
 * web limiter and the critical limiter that guards login; the symptom is HTTP
 * 429, which looks like broken pages or broken authentication.
 *
 * This resets counters in the dev Redis. It never changes the limits
 * themselves — they are a production security control.
 */
export function resetDevRateLimits() {
  try {
    execFileSync(
      'docker',
      [
        'exec',
        'ai-gateway-dev-redis-1',
        'sh',
        '-c',
        'for k in $(redis-cli -a "$REDIS_PASSWORD" --scan --pattern "rateLimit*" 2>/dev/null); do redis-cli -a "$REDIS_PASSWORD" DEL "$k" >/dev/null 2>&1; done',
      ],
      { stdio: 'ignore' }
    )
  } catch {
    // Non-fatal: a 429 still surfaces clearly in the failing assertion.
  }
}

/**
 * Clears accumulated DEVELOPMENT login sessions.
 *
 * Every browser test that logs in mints a session and never logs out, so a few
 * suite runs exhaust USER_SESSION_ACTIVE_LIMIT (default 50). The backend then
 * answers login with HTTP 409 `AUTH_SESSION_LIMIT`, which looks exactly like
 * broken authentication — it cost real debugging time before being identified.
 *
 * This clears dev session rows. It does NOT change the limit, which is a
 * deliberate production control against session-hoarding.
 */
export function cleanupStaleDevSessions() {
  try {
    execFileSync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        '../scripts/cleanup-e2e-sessions.ps1',
        '-Environment',
        'dev',
        '-RunId',
        E2E_RUN_ID,
        '-StaleMinutes',
        '60',
        '-Execute',
      ],
      { stdio: 'ignore' }
    )
  } catch {
    // Non-fatal: signInAsRoot reports a 409 explicitly if the limit is hit.
  }
}

/**
 * Logs in as root and waits for the console.
 *
 * Distinguishes the two infrastructure failures that otherwise present as
 * "login is broken": 429 from the rate limiter and 409 from the session limit.
 */
export async function signInAsRoot(
  page: Page,
  password: string
): Promise<{ sid: string; accessToken: string }> {
  await page.goto(`${APP_ORIGIN}/sign-in`)
  await page.waitForLoadState('networkidle')
  await page.locator('input[name="username"]').fill('root')
  await page.locator('input[name="password"]').fill(password)
  const loginResponse = page.waitForResponse(
    (response) => response.url().includes('/api/user/login'),
    { timeout: 20_000 }
  )
  await page.locator('button[type="submit"]').click()

  let response
  try {
    response = await loginResponse
  } catch {
    throw new Error(
      'Login network error: the browser received no /api/user/login response.'
    )
  }
  const body = await response.json().catch(() => null)
  if (!response.ok()) {
    const code = body?.code ?? 'UNKNOWN'
    throw new Error(describeLoginFailure(response.status(), code))
  }

  await page.waitForURL((u) => u.pathname.startsWith('/dashboard'), {
    timeout: 20_000,
  })

  const sid = body?.data?.session?.sid
  if (typeof sid !== 'string' || !sid) {
    throw new Error('Login succeeded without a Session SID.')
  }
  const accessToken = body?.data?.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Login succeeded without an access token.')
  }
  return { sid, accessToken }
}

export async function cleanupTestSession(page: Page, sid: string) {
  let logoutError: unknown
  try {
    const response = await page.request.post(
      `${APP_ORIGIN}/api/user/auth/logout`,
      {
        headers: { 'X-Auth-Session': sid },
        failOnStatusCode: false,
      }
    )
    if (!response.ok()) {
      logoutError = new Error(`Logout failed with HTTP ${response.status()}.`)
    }
  } catch (error) {
    logoutError = error
  } finally {
    execFileSync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        '../scripts/cleanup-e2e-sessions.ps1',
        '-Environment',
        'dev',
        '-SessionId',
        sid,
        '-Execute',
      ],
      { stdio: 'ignore' }
    )
  }
  if (logoutError) throw logoutError
}

export async function withRootSession<T>(
  page: Page,
  password: string,
  run: (session: { sid: string; accessToken: string }) => Promise<T>
): Promise<T> {
  const session = await signInAsRoot(page, password)
  try {
    return await run(session)
  } finally {
    await cleanupTestSession(page, session.sid)
  }
}

/** Horizontal overflow is the most common responsive defect. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth > doc.clientWidth + 1
  })
}
