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
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { APP_ORIGIN, newAppPage, withRootSession } from './helpers/app-state'

test.skip(
  process.env.HYC_LIVE_E2E !== '1',
  'Set HYC_LIVE_E2E=1 to exercise the running development backend.'
)

test('live login and authenticated routes use the repaired runtime', async ({
  browser,
}) => {
  const password = process.env.HYC_LIVE_PASSWORD
  if (!password) throw new Error('HYC_LIVE_PASSWORD is required')

  const page = await newAppPage(browser, {
    theme: 'light',
    locale: 'en',
    viewport: { width: 1440, height: 900 },
  })

  await withRootSession(page, password, async () => {
    const routes = [
      '/dashboard/overview',
      '/keys',
      '/usage-logs/common',
    ] as const
    for (const route of routes) {
      await page.locator(`a[href="${route}"]`).first().click()
      await expect(page).toHaveURL(
        new RegExp(`${route.replaceAll('/', '\\/')}$`)
      )
      await expect(page.getByText('Route not found')).toHaveCount(0)
      await expect(page.locator('input[name="username"]')).toHaveCount(0)
      await expect(page.locator('body')).not.toContainText('© 2026 New API')
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth
        )
      ).toBe(false)

      if (route === '/dashboard/overview') {
        await page.reload()
        await expect(page).toHaveURL(/\/dashboard\/overview$/)
        await expect(page.locator('input[name="username"]')).toHaveCount(0)
        await expect(page.getByText('HYC AI').first()).toBeVisible()
        await page.screenshot({
          path: path.resolve(
            '..',
            'artifacts',
            'phase4-corrective',
            'after',
            'dashboard-after.png'
          ),
          fullPage: true,
        })
      }
    }
  })
  expect(page.url().startsWith(APP_ORIGIN)).toBe(true)
  await page.context().close()
})
