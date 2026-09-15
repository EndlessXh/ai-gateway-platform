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
 * Phase 4.6 — theme and locale truthfulness.
 *
 * The first group are META-TESTS: they assert that a *broken* state injection
 * is detected. They exist because earlier passes reported green dark-mode and
 * Chinese coverage while rendering light and English respectively. A test that
 * cannot fail is not evidence.
 *
 * The remaining groups re-run the browser matrix through the shared helpers in
 * e2e/helpers/app-state.ts.
 */
import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  APP_ORIGIN,
  THEME_COOKIE,
  assertLocaleApplied,
  assertLocalesDiffer,
  assertThemeApplied,
  findRawI18nKeys,
  hasHorizontalOverflow,
  newAppPage,
  resetDevRateLimits,
  cleanupStaleDevSessions,
  withRootSession,
  opposingColorScheme,
  resolvedTheme,
} from './helpers/app-state'

const ARTIFACTS = path.resolve('..', 'artifacts', 'phase4-6')

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
})

// A full suite trips both rate limiters; clear the DEVELOPMENT counters before
// each test so a 429 never masquerades as a broken page or broken login.
test.beforeEach(() => {
  resetDevRateLimits()
})

// ---------------------------------------------------------------------------
// Meta-tests: prove a broken injection is caught
// ---------------------------------------------------------------------------
test.describe('anti-false-pass guards', () => {
  test('writing the theme to localStorage (the old bug) does NOT produce dark', async ({
    browser,
  }) => {
    // Exactly what the Phase 4.5 helper did. The cookie is never set, so the
    // provider falls back to `system`, which follows prefers-color-scheme.
    const context = await browser.newContext({ colorScheme: 'light' })
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.localStorage.setItem('vite-ui-theme', 'dark')
      window.localStorage.setItem('theme', 'dark')
    })
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')

    expect(
      await resolvedTheme(page),
      'localStorage must not be able to set the theme; if this renders dark the provider changed and the helper needs updating'
    ).toBe('light')
    await context.close()
  })

  test('an invalid theme cookie falls back to system, so colorScheme must be pinned', async ({
    browser,
  }) => {
    // This is the subtle one: a wrong cookie value still yields dark when the
    // OS says dark. Any helper that does not pin colorScheme can pass on this
    // path while the cookie is completely broken.
    const context = await browser.newContext({ colorScheme: 'dark' })
    await context.addCookies([
      { name: THEME_COOKIE, value: 'not-a-theme', url: APP_ORIGIN },
    ])
    const page = await context.newPage()
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')

    expect(
      await resolvedTheme(page),
      'invalid cookie should fall back to system (dark here) - this is why the helper pins the opposing scheme'
    ).toBe('dark')
    await context.close()

    // And the helper's own defence: requesting dark pins colorScheme light,
    // so only a correctly-read cookie can produce dark.
    expect(opposingColorScheme('dark')).toBe('light')
    expect(opposingColorScheme('light')).toBe('dark')
  })

  test('the helper reaches dark against an opposing system preference', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, { theme: 'dark' })
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')
    // colorScheme is light here, so dark can only come from the cookie.
    await assertThemeApplied(page, 'dark')
    await page.context().close()
  })

  test('the helper reaches light against an opposing system preference', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, { theme: 'light' })
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')
    await assertThemeApplied(page, 'light')
    await page.context().close()
  })

  test('which locale is the default depends on context config, so both directions must be asserted', async ({
    browser,
  }) => {
    // Measured 2026-07-29, and the reason `assertLocaleApplied` checks a
    // marker is PRESENT *and* the opposite marker is ABSENT.
    //
    // The "default" locale is not a fixed property of the machine:
    //   - a bare browser.newContext() inherits the OS locale, which is
    //     zh-Hans-HK here, so the app renders CHINESE with no injection
    //   - the project preset devices['Desktop Chrome'] pins locale en-US,
    //     so inside this runner the app renders ENGLISH with no injection
    //
    // So whichever locale a test happens to assert may already be the default,
    // and a one-directional "is Chinese present" or "is English present" check
    // can pass while injection is completely broken. Which direction is unsafe
    // flips with playwright.config.ts, which is exactly why neither direction
    // may be trusted on its own.
    const projectDefault = await browser.newContext()
    const projectPage = await projectDefault.newPage()
    await projectPage.goto(`${APP_ORIGIN}/sign-in`)
    await projectPage.waitForLoadState('networkidle')
    const projectText = await projectPage.locator('body').innerText()
    await projectDefault.close()

    const osDefault = await browser.newContext({ locale: 'zh-Hans-HK' })
    const osPage = await osDefault.newPage()
    await osPage.goto(`${APP_ORIGIN}/sign-in`)
    await osPage.waitForLoadState('networkidle')
    const osText = await osPage.locator('body').innerText()
    await osDefault.close()

    // Neither page had any locale injected, yet they render different
    // languages purely from context configuration.
    expect(
      /Toggle theme/i.test(projectText),
      'project default context should render English chrome'
    ).toBe(true)
    expect(
      /切换主题/.test(osText),
      'a Chinese-locale context should render Chinese chrome without any injection'
    ).toBe(true)
    expect(
      projectText === osText,
      'the two default contexts must differ, proving the default is config-dependent'
    ).toBe(false)
  })

  test('Phase 4 product copy follows the selected locale', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, { locale: 'zhCN' })
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')

    const text = await page.locator('body').innerText()
    const untranslated = [
      'GATEWAY ACCESS',
      'Credentials are the control plane',
      'Neutral model routing',
      'Documentation',
      'Support',
      'Legal notice',
    ].filter((phrase) => text.includes(phrase))

    expect(
      untranslated,
      `these strings should be translated in zhCN: ${untranslated.join(' | ')}`
    ).toHaveLength(0)
    await page.context().close()
  })

  test('English must be actively applied, which is the direction that proves injection', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, { locale: 'en' })
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')
    await assertLocaleApplied(page, 'en')
    await page.context().close()
  })

  test('the helper rejects an unsupported locale code instead of silently falling back', async ({
    browser,
  }) => {
    await expect(
      // `zh` happens to map to zhCN via convertDetectedLanguage, but tests must
      // name the code the app actually uses, so the helper refuses it.
      newAppPage(browser, { locale: 'zh' as never })
    ).rejects.toThrow(/Unsupported locale/)
  })
})

// ---------------------------------------------------------------------------
// Real matrix, through the helpers
// ---------------------------------------------------------------------------
const PUBLIC_ROUTES = ['/', '/pricing', '/sign-in', '/sign-up'] as const
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 },
] as const

for (const theme of ['light', 'dark'] as const) {
  for (const locale of ['en', 'zhCN'] as const) {
    for (const route of PUBLIC_ROUTES) {
      test(`${route} @ ${theme}/${locale} applies real state`, async ({
        browser,
      }) => {
        const page = await newAppPage(browser, { theme, locale })
        await page.goto(`${APP_ORIGIN}${route}`)
        await page.waitForLoadState('networkidle')

        await assertThemeApplied(page, theme)
        await assertLocaleApplied(page, locale)
        await expect(page.locator('body')).not.toContainText(/route not found/i)

        expect(
          await findRawI18nKeys(page),
          `${route} shows raw i18n keys in ${locale}`
        ).toHaveLength(0)

        expect(
          await hasHorizontalOverflow(page),
          `${route} overflows horizontally at ${theme}/${locale}`
        ).toBe(false)

        await page.context().close()
      })
    }
  }
}

test('en and zhCN render genuinely different text on every public route', async ({
  browser,
}) => {
  test.slow()
  for (const route of PUBLIC_ROUTES) {
    const enPage = await newAppPage(browser, { locale: 'en' })
    await enPage.goto(`${APP_ORIGIN}${route}`)
    await expect(
      enPage.getByRole('button', { name: 'Toggle theme' })
    ).toBeVisible()
    await assertLocaleApplied(enPage, 'en')
    const enText = await enPage.locator('body').innerText()
    await enPage.context().close()

    const zhPage = await newAppPage(browser, { locale: 'zhCN' })
    await zhPage.goto(`${APP_ORIGIN}${route}`)
    await expect(zhPage.getByRole('button', { name: '切换主题' })).toBeVisible()
    await assertLocaleApplied(zhPage, 'zhCN')
    const zhText = await zhPage.locator('body').innerText()
    await zhPage.context().close()

    assertLocalesDiffer(enText, zhText, route)
  }
})

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow at ${vp.name} in dark/zhCN`, async ({
    browser,
  }) => {
    // Dark + Chinese is the combination least likely to have been exercised,
    // and Chinese text metrics differ enough to expose layout assumptions.
    for (const route of PUBLIC_ROUTES) {
      const page = await newAppPage(browser, {
        theme: 'dark',
        locale: 'zhCN',
        viewport: { width: vp.width, height: vp.height },
      })
      await page.goto(`${APP_ORIGIN}${route}`)
      await page.waitForLoadState('networkidle')

      await assertThemeApplied(page, 'dark')
      expect(
        await hasHorizontalOverflow(page),
        `${route} overflows at ${vp.name} in dark/zhCN`
      ).toBe(false)
      await page.context().close()
    }
  })
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
test('theme and locale survive reload and direct navigation', async ({
  browser,
}) => {
  const page = await newAppPage(browser, { theme: 'dark', locale: 'en' })
  await page.goto(`${APP_ORIGIN}/pricing`)
  await page.waitForLoadState('networkidle')
  await assertThemeApplied(page, 'dark')
  await assertLocaleApplied(page, 'en')

  await page.reload()
  await page.waitForLoadState('networkidle')
  await assertThemeApplied(page, 'dark')
  await assertLocaleApplied(page, 'en')

  // Direct navigation to another route in the same context.
  await page.goto(`${APP_ORIGIN}/sign-in`)
  await page.waitForLoadState('networkidle')
  await assertThemeApplied(page, 'dark')
  await assertLocaleApplied(page, 'en')

  await page.screenshot({
    path: path.join(ARTIFACTS, 'sign-in-dark-en-after-reload.png'),
  })
  await page.context().close()
})

test('404 keeps theme and locale', async ({ browser }) => {
  const page = await newAppPage(browser, { theme: 'dark', locale: 'en' })
  await page.goto(`${APP_ORIGIN}/no-such-route-p46`)
  await page.waitForLoadState('networkidle')

  await assertThemeApplied(page, 'dark')
  await expect(page.locator('body')).toContainText(/404|not found/i)
  await page.screenshot({ path: path.join(ARTIFACTS, '404-dark-en.png') })
  await page.context().close()
})

// ---------------------------------------------------------------------------
// Authenticated shell — same mechanism as the public site
// ---------------------------------------------------------------------------
test.describe('authenticated shell', () => {
  test.skip(
    !process.env.HYC_LIVE_PASSWORD,
    'Set HYC_LIVE_PASSWORD to audit authenticated routes.'
  )

  test.beforeAll(() => {
    // A full suite exhausts two independent DEVELOPMENT budgets, and both
    // present as "login is broken":
    //   - the rate limiters (429)
    //   - USER_SESSION_ACTIVE_LIMIT (409), because every logging-in test
    //     mints a session and never logs out
    // Neither limit is relaxed; only the accumulated dev state is cleared.
    resetDevRateLimits()
    cleanupStaleDevSessions()
  })
  test('console honours the same theme and locale mechanism', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, { theme: 'dark', locale: 'en' })
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')
    await assertThemeApplied(page, 'dark')

    await withRootSession(
      page,
      process.env.HYC_LIVE_PASSWORD ?? '',
      async () => {
        for (const route of [
          '/dashboard/overview',
          '/keys',
          '/usage-logs/common',
        ]) {
          await page.goto(`${APP_ORIGIN}${route}`)
          await page.waitForLoadState('networkidle')

          await assertThemeApplied(page, 'dark')
          await assertLocaleApplied(page, 'en', 'console')
          expect(
            await hasHorizontalOverflow(page),
            `${route} overflows horizontally`
          ).toBe(false)

          await page.reload()
          await page.waitForLoadState('networkidle')
          await assertThemeApplied(page, 'dark')
          expect(new URL(page.url()).pathname).toBe(route)
        }

        await page.goto(`${APP_ORIGIN}/keys`)
        await page.waitForLoadState('networkidle')
        await page.screenshot({
          path: path.join(ARTIFACTS, 'keys-dark-en.png'),
          fullPage: true,
        })
      }
    )
    await page.context().close()
  })

  test('console renders Chinese when zhCN is selected', async ({ browser }) => {
    const page = await newAppPage(browser, { theme: 'light', locale: 'zhCN' })
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await page.waitForLoadState('networkidle')

    await withRootSession(
      page,
      process.env.HYC_LIVE_PASSWORD ?? '',
      async () => {
        await page.goto(`${APP_ORIGIN}/keys`)
        await page.waitForLoadState('networkidle')
        await assertLocaleApplied(page, 'zhCN', 'console')
        await assertThemeApplied(page, 'light')

        await page.screenshot({
          path: path.join(ARTIFACTS, 'keys-light-zhCN.png'),
        })
      }
    )
    await page.context().close()
  })
})
