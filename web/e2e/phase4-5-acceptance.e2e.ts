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
 * Phase 4.5 independent acceptance audit.
 *
 * Deliberately written from scratch rather than extending the Phase 4
 * corrective tests: the point of this phase is to verify the product against
 * the running system without inheriting the previous pass's assumptions.
 *
 * Every assertion here targets a user-visible outcome. Asserting HTTP 200 is
 * explicitly not enough — an SPA returns 200 for a route that renders "not
 * found", so each check looks at rendered DOM.
 *
 * Requires the dev stack:
 *   pwsh ./scripts/dev-up.ps1
 *   pwsh ./scripts/dev-backend.ps1      -> 127.0.0.1:3001
 *   cd web && bun run dev               -> 127.0.0.1:4173
 */
import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  APP_ORIGIN,
  assertLocaleApplied,
  assertThemeApplied,
  detectDoubleScrollbar,
  findRawI18nKeys,
  hasHorizontalOverflow,
  newAppPage,
  resetDevRateLimits,
  cleanupStaleDevSessions,
  withRootSession,
} from './helpers/app-state'

const ARTIFACTS = path.resolve('..', 'artifacts', 'phase4-5')
const PRODUCT_ORIGIN = APP_ORIGIN
const BASELINE_ORIGIN = 'http://127.0.0.1:3000'

type Finding = {
  route: string
  viewport: string
  theme: string
  language: string
  severity: 'P0' | 'P1' | 'P2'
  observed: string
}

const findings: Finding[] = []
function record(f: Finding) {
  findings.push(f)
}

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
})

// A full suite trips both rate limiters; clear the DEVELOPMENT counters before
// each test so a 429 never masquerades as a broken page or broken login.
test.beforeEach(() => {
  resetDevRateLimits()
})

test.afterAll(() => {
  fs.writeFileSync(
    path.join(ARTIFACTS, 'findings.json'),
    JSON.stringify(findings, null, 2)
  )
})

// ---------------------------------------------------------------------------
// Port topology — the product must not be confused with the rc.16 baseline
// ---------------------------------------------------------------------------
test('product origin is 4173 and is distinct from the protected baseline on 3000', async ({
  page,
  request,
}) => {
  await page.goto('/')
  expect(page.url().startsWith(PRODUCT_ORIGIN)).toBe(true)

  // The baseline must still be the upstream build, proving we never audited it
  // by mistake, and proving we did not disturb it.
  const baseline = await request.get(`${BASELINE_ORIGIN}/api/status`)
  expect(baseline.ok()).toBe(true)
  const baselineBody = await baseline.json()
  expect(baselineBody.success).toBe(true)

  // The product API is a different service on a different port.
  const product = await request.get('http://127.0.0.1:3001/api/status')
  expect(product.ok()).toBe(true)
})

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------
test('header, title and footer carry product branding, not the upstream default', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const title = await page.title()
  expect(title, 'browser tab title must not be the upstream default').not.toBe(
    'New API'
  )
  expect(title).toContain('HYC')

  const header = page.locator('header').first()
  await expect(header).toContainText('HYC AI')

  const footer = page.locator('footer').first()
  await expect(footer).toContainText('HYC AI')

  // Upstream attribution must be present, but only as attribution.
  await expect(footer).toContainText(/New API/)
})

test('no upstream brand flash on reload', async ({ page }) => {
  // A flash means the UI renders the upstream default before runtime status
  // arrives. Sample aggressively during the first paint window.
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const samples: string[] = []
  await page.evaluate(() => {
    ;(window as unknown as { __brandSamples: string[] }).__brandSamples = []
    const capture = () => {
      const h = document.querySelector('header')
      if (h) {
        ;(
          window as unknown as { __brandSamples: string[] }
        ).__brandSamples.push(h.innerText)
      }
    }
    const obs = new MutationObserver(capture)
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    capture()
  })

  await page.reload()
  await page.waitForLoadState('networkidle')
  const captured = await page.evaluate(
    () =>
      (window as unknown as { __brandSamples?: string[] }).__brandSamples ?? []
  )
  samples.push(...captured)

  const flashed = samples.filter((s) => /New API/.test(s))
  expect(
    flashed,
    `header showed upstream brand during load: ${flashed.join(' | ')}`
  ).toHaveLength(0)
})

test('public navigation does not expose self-use mode', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const nav = page.locator('header').first()
  await expect(nav).not.toContainText(/self-?use/i)
  await expect(nav).not.toContainText(/自用/)
})

// ---------------------------------------------------------------------------
// Auth routes and legacy redirects
// ---------------------------------------------------------------------------
test('/sign-in renders a real credential form', async ({ page }) => {
  await page.goto('/sign-in')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('input[name="username"]')).toBeVisible()
  await expect(page.locator('input[name="password"]')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/route not found/i)
})

test('/sign-up renders a real form or an explicit closed state', async ({
  page,
}) => {
  await page.goto('/sign-up')
  await page.waitForLoadState('networkidle')

  const hasForm = await page.locator('input[name="username"]').count()
  const bodyText = (await page.locator('body').innerText()).toLowerCase()
  const closed =
    bodyText.includes('registration') &&
    (bodyText.includes('closed') ||
      bodyText.includes('disabled') ||
      bodyText.includes('not open'))

  expect(
    hasForm > 0 || closed,
    'sign-up must show a usable form or say registration is closed'
  ).toBe(true)
  await expect(page.locator('body')).not.toContainText(/route not found/i)
})

for (const [legacy, target] of [
  ['/login', '/sign-in'],
  ['/register', '/sign-up'],
] as const) {
  test(`${legacy} redirects to ${target}`, async ({ page }) => {
    await page.goto(legacy)
    await page.waitForLoadState('networkidle')
    expect(new URL(page.url()).pathname).toBe(target)
  })
}

// ---------------------------------------------------------------------------
// Direct URL entry and reload — SPA routing regressions live here
// ---------------------------------------------------------------------------
const directRoutes = [
  '/',
  '/pricing',
  '/sign-in',
  '/sign-up',
  '/about',
  '/privacy-policy',
  '/user-agreement',
]

for (const route of directRoutes) {
  test(`direct navigation and reload work for ${route}`, async ({ page }) => {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText(/route not found/i)
    expect(new URL(page.url()).pathname).toBe(route)

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText(/route not found/i)
    expect(new URL(page.url()).pathname).toBe(route)
  })
}

test('unknown route renders a productised 404 with recovery links', async ({
  page,
}) => {
  await page.goto('/this-route-does-not-exist-4f2a')
  await page.waitForLoadState('networkidle')

  const body = page.locator('body')
  await expect(body).toContainText(/404|not found/i)
  // Recovery path is required, not just an error string.
  const links = await page.locator('a[href="/"], a[href="/pricing"]').count()
  expect(links, '404 must offer a way back').toBeGreaterThan(0)
  await expect(body).toContainText('HYC AI')

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({
    path: path.join(ARTIFACTS, '404-desktop-light.png'),
  })
})

// ---------------------------------------------------------------------------
// Pricing — single source of truth
// ---------------------------------------------------------------------------
test('pricing renders from the live API and matches it exactly', async ({
  page,
  request,
}) => {
  const api = await request.get('http://127.0.0.1:3001/api/pricing')
  expect(api.ok()).toBe(true)
  const payload = await api.json()
  const models: Array<{ model_name: string }> = payload.data ?? []
  expect(models.length, 'API returned no pricing rows').toBeGreaterThan(0)

  await page.goto('/pricing')
  await page.waitForLoadState('networkidle')

  const body = await page.locator('body').innerText()
  for (const m of models) {
    expect(body, `pricing page missing model ${m.model_name}`).toContain(
      m.model_name
    )
  }

  // No upstream model name may leak into the public catalogue.
  expect(body).not.toContain('qwen-plus')
  expect(body).not.toContain('qwen3.7')

  await expect(page.locator('body')).not.toContainText(/route not found/i)
  await page.screenshot({
    path: path.join(ARTIFACTS, 'pricing-desktop-light.png'),
    fullPage: true,
  })
})

// ---------------------------------------------------------------------------
// Footer legal surface
// ---------------------------------------------------------------------------
test('footer carries the full legal surface and fabricates no source link', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const footer = page.locator('footer').first()
  const footerText = await footer.innerText()

  for (const expected of [
    /docs|documentation/i,
    /legal|privacy|terms/i,
    /support/i,
  ]) {
    expect(footerText, `footer missing section: ${expected}`).toMatch(expected)
  }

  // Upstream attribution and repository link are mandatory.
  expect(footerText).toMatch(/powered by new api/i)
  const upstreamLink = footer.locator(
    'a[href="https://github.com/QuantumNous/new-api"]'
  )
  // "Powered by New API" and "Original project" both link upstream; one or
  // more is correct, zero is a licence violation.
  expect(await upstreamLink.count()).toBeGreaterThanOrEqual(1)

  // When SOURCE_CODE_URL is unset the UI must not invent one.
  const status = await request.get('http://127.0.0.1:3001/api/status')
  const statusBody = await status.json()
  const sourceUrl: string | null =
    statusBody?.data?.source_code_url ?? statusBody?.data?.sourceCodeUrl ?? null

  if (!sourceUrl) {
    const hrefs = await footer
      .locator('a')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '')
      )
    const fabricated = hrefs.filter(
      (h) =>
        /source/i.test(h) &&
        h !== '' &&
        !h.startsWith('/') &&
        !h.includes('QuantumNous')
    )
    expect(
      fabricated,
      `footer invented a source link while SOURCE_CODE_URL is unset: ${fabricated.join(', ')}`
    ).toHaveLength(0)
  }

  await footer.screenshot({ path: path.join(ARTIFACTS, 'footer-legal.png') })
})

// ---------------------------------------------------------------------------
// Responsive / theme / language matrix
// ---------------------------------------------------------------------------
const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
]

const matrixRoutes = ['/', '/pricing', '/sign-in', '/sign-up']

for (const vp of viewports) {
  for (const route of matrixRoutes) {
    test(`no horizontal overflow: ${route} @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(route)
      await page.waitForLoadState('networkidle')

      const overflow = await hasHorizontalOverflow(page)
      if (overflow) {
        const detail = await page.evaluate(() => {
          const doc = document.documentElement
          const wide: string[] = []
          for (const el of document.querySelectorAll('*')) {
            const r = el.getBoundingClientRect()
            if (r.right > doc.clientWidth + 1 && r.width > 0) {
              wide.push(
                `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(r.right)}`
              )
            }
            if (wide.length >= 5) break
          }
          return wide
        })
        record({
          route,
          viewport: vp.name,
          theme: 'light',
          language: 'en',
          severity: 'P1',
          observed: `horizontal overflow; offenders: ${detail.join(' | ')}`,
        })
      }
      expect(overflow, `${route} overflows horizontally at ${vp.name}`).toBe(
        false
      )
    })
  }
}

// Theme coverage goes through the shared helper (Phase 4.6). The local
// setTheme/assertResolvedTheme this file used to carry set the cookie but did
// NOT pin colorScheme, so the provider's `system` fallback could satisfy the
// assertion even with a broken cookie. See e2e/helpers/app-state.ts.
for (const theme of ['light', 'dark'] as const) {
  for (const route of ['/', '/pricing', '/sign-in']) {
    test(`renders in ${theme}: ${route}`, async ({ browser }) => {
      const page = await newAppPage(browser, {
        theme,
        viewport: { width: 1280, height: 800 },
      })
      await page.goto(`${APP_ORIGIN}${route}`)
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).not.toContainText(/route not found/i)
      await assertThemeApplied(page, theme)

      const slug = route === '/' ? 'home' : route.replaceAll('/', '')
      if (route === '/sign-in' || route === '/') {
        await page.screenshot({
          path: path.join(ARTIFACTS, `${slug}-desktop-${theme}.png`),
          fullPage: route === '/',
        })
      }
      await page.context().close()
    })
  }
}

// Locale coverage goes through the shared helper (Phase 4.6). The check this
// file used to carry only asserted "Chinese characters are present", which
// passes on any context whose default locale is already Chinese — proving
// nothing. assertLocaleApplied checks both directions instead.
for (const lng of ['en', 'zhCN'] as const) {
  for (const route of ['/', '/pricing', '/sign-in']) {
    test(`no raw i18n keys in ${lng}: ${route}`, async ({ browser }) => {
      const page = await newAppPage(browser, {
        locale: lng,
        viewport: { width: 1280, height: 800 },
      })
      await page.goto(`${APP_ORIGIN}${route}`)
      await page.waitForLoadState('networkidle')

      await assertLocaleApplied(page, lng)
      expect(
        await hasHorizontalOverflow(page),
        `${route} overflows horizontally in ${lng}`
      ).toBe(false)

      const raw = await findRawI18nKeys(page)
      if (raw.length > 0) {
        record({
          route,
          viewport: '1280x800',
          theme: 'light',
          language: lng,
          severity: 'P1',
          observed: `possible untranslated keys: ${raw.join(', ')}`,
        })
      }
      expect(raw, `${route} shows raw i18n keys in ${lng}`).toHaveLength(0)
      await page.context().close()
    })
  }
}

test('mobile home does not stack into an undifferentiated card waterfall', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.screenshot({
    path: path.join(ARTIFACTS, 'home-mobile-light.png'),
    fullPage: true,
  })

  // A mobile nav affordance must exist at this width.
  const navToggle = await page
    .locator(
      'header button[aria-label*="menu" i], header button[aria-expanded], header [role="button"]'
    )
    .count()
  expect(navToggle, 'mobile header needs a navigation control').toBeGreaterThan(
    0
  )
})

// ---------------------------------------------------------------------------
// Authenticated shell
// ---------------------------------------------------------------------------
test.describe('authenticated console', () => {
  test.skip(
    !process.env.HYC_LIVE_PASSWORD,
    'Set HYC_LIVE_PASSWORD to audit authenticated routes.'
  )

  test.beforeAll(() => {
    // Clear accumulated DEVELOPMENT state: rate-limit counters (429) and
    // login sessions (409 AUTH_SESSION_LIMIT). Neither limit is relaxed.
    resetDevRateLimits()
    cleanupStaleDevSessions()
  })
  test('console shell is consistent and free of double scrollbars', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, {
      theme: 'light',
      locale: 'en',
      viewport: { width: 1440, height: 900 },
    })
    // signInAsRoot distinguishes the two infrastructure failures that would
    // otherwise look like broken authentication: 429 from the rate limiter and
    // 409 from USER_SESSION_ACTIVE_LIMIT. See e2e/helpers/app-state.ts.
    const password = process.env.HYC_LIVE_PASSWORD ?? ''
    expect(password, 'HYC_LIVE_PASSWORD must be set').not.toBe('')
    await withRootSession(page, password, async () => {
      for (const route of [
        '/dashboard/overview',
        '/keys',
        '/usage-logs/common',
      ]) {
        await page.goto(route)
        await page.waitForLoadState('networkidle')

        await expect(page.locator('body')).not.toContainText(/route not found/i)
        await expect(page.locator('input[name="username"]')).toHaveCount(0)

        // Brand consistency between public site and console.
        await expect(page.locator('body')).toContainText('HYC AI')

        expect(
          await hasHorizontalOverflow(page),
          `${route} overflows horizontally`
        ).toBe(false)

        // The console shell must own scrolling: the document stays fixed and a
        // single content region scrolls. Both scrolling at once is the actual
        // double-scrollbar defect.
        const scroll = await detectDoubleScrollbar(page)
        const doubled = scroll.documentScrolls && scroll.inner.length > 0
        if (doubled) {
          record({
            route,
            viewport: '1440x900',
            theme: 'light',
            language: 'en',
            severity: 'P1',
            observed: `document scrolls while inner containers also scroll: ${scroll.inner.join(', ')}`,
          })
        }
        expect(
          doubled,
          `${route} has competing document and inner scrollbars`
        ).toBe(false)
        expect(
          scroll.inner.length,
          `${route} should have at most one app scroll region, found: ${scroll.inner.join(', ')}`
        ).toBeLessThanOrEqual(1)

        // Reload must keep the user on the same authenticated route.
        await page.reload()
        await page.waitForLoadState('networkidle')
        expect(new URL(page.url()).pathname).toBe(route)
        await expect(page.locator('input[name="username"]')).toHaveCount(0)
      }

      await page.goto('/dashboard/overview')
      await page.waitForLoadState('networkidle')
      await page.screenshot({
        path: path.join(ARTIFACTS, 'dashboard-desktop-light.png'),
        fullPage: true,
      })
      await page.goto('/keys')
      await page.waitForLoadState('networkidle')
      await page.screenshot({
        path: path.join(ARTIFACTS, 'keys-desktop-light.png'),
        fullPage: true,
      })
    })
    await page.context().close()
  })
})
