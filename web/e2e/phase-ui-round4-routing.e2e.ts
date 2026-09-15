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
import { expect, test } from '@playwright/test'

import {
  APP_ORIGIN,
  hasHorizontalOverflow,
  newAppPage,
} from './helpers/app-state'

/*
  Round 4 regression suite.

  `/leaderboard` returned the 404 page for a user who typed it into the address
  bar, while every existing test reached the leaderboard by clicking the header
  link — which pointed at `/rankings`. Internal navigation and direct entry are
  different code paths in a file-based router, and only one of them was ever
  exercised. Everything here therefore navigates by URL, never by click, except
  the one test that specifically asserts the header target.
*/

const PUBLIC_ROUTES = [
  '/',
  '/model-catalog',
  '/leaderboard',
  '/pricing',
  '/sign-in',
  '/sign-up',
  '/about',
] as const

// Text the 404 page renders. If a real page ever contains this we want to know.
const NOT_FOUND_MARKER = /Route not found|未找到页面/

test('every public route opens on direct entry and survives reload', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    locale: 'en',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
  })

  for (const route of PUBLIC_ROUTES) {
    await page.goto(`${APP_ORIGIN}${route}`)
    await page.waitForLoadState('networkidle')
    await expect(
      page.locator('body'),
      `direct entry to ${route} rendered the 404 page`
    ).not.toHaveText(NOT_FOUND_MARKER)
    await expect(page.locator('h1').first()).toBeVisible()
    expect(await hasHorizontalOverflow(page), `overflow at ${route}`).toBe(
      false
    )

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(
      page.locator('body'),
      `reload of ${route} rendered the 404 page`
    ).not.toHaveText(NOT_FOUND_MARKER)
    expect(new URL(page.url()).pathname).toBe(route)
  }

  await page.context().close()
})

test('leaderboard is reachable by URL, by legacy path, and from the header', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    locale: 'en',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
  })
  const heading = page.getByRole('heading', { level: 1, name: /leaderboard/i })

  // Canonical, typed directly.
  await page.goto(`${APP_ORIGIN}/leaderboard`)
  await page.waitForLoadState('networkidle')
  await expect(heading).toBeVisible()

  // Search params must survive, or period tabs break on a shared link.
  await page.goto(`${APP_ORIGIN}/leaderboard?period=month`)
  await page.waitForLoadState('networkidle')
  await expect(heading).toBeVisible()
  expect(page.url()).toContain('period=month')

  // Legacy path redirects to canonical rather than 404ing or rendering a
  // second copy of the page at a second URL.
  await page.goto(`${APP_ORIGIN}/rankings?period=week`)
  await page.waitForLoadState('networkidle')
  await expect(heading).toBeVisible()
  const redirected = new URL(page.url())
  expect(redirected.pathname).toBe('/leaderboard')
  expect(redirected.searchParams.get('period')).toBe('week')

  // The header must point at the canonical route. This is the assertion that
  // would have caught the original defect.
  await page.goto(`${APP_ORIGIN}/`)
  await page.waitForLoadState('networkidle')
  const navLink = page
    .getByRole('navigation')
    .getByRole('link', { name: /rankings|leaderboard/i })
    .first()
  await expect(navLink).toHaveAttribute('href', '/leaderboard')

  await page.context().close()
})

test('a genuinely unknown path still renders 404', async ({ browser }) => {
  const page = await newAppPage(browser, {
    locale: 'en',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
  })

  await page.goto(`${APP_ORIGIN}/this-route-does-not-exist`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('body')).toHaveText(NOT_FOUND_MARKER)

  await page.context().close()
})

test('public pages carry no devtools overlays', async ({ browser }) => {
  const page = await newAppPage(browser, {
    locale: 'en',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
  })

  for (const route of PUBLIC_ROUTES) {
    await page.goto(`${APP_ORIGIN}${route}`)
    await page.waitForLoadState('networkidle')

    // Router Devtools panel (was bottom-right) and the React Query button
    // (was bottom-left, a coloured circle that repeatedly turned up in visual
    // review screenshots and was mistaken for a browser extension).
    const overlays = await page.evaluate(
      () =>
        document.querySelectorAll(
          '.TanStackRouterDevtools,[data-tanstack-router-devtools],#tsr-dev-tools,.tsqd-parent-container,[aria-label*="Query Devtools" i]'
        ).length
    )
    expect(overlays, `devtools overlay present on ${route}`).toBe(0)
  }

  await page.context().close()
})
