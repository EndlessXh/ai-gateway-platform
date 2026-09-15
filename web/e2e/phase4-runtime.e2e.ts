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
import { expect, test, type Page } from '@playwright/test'

const statusPayload = {
  success: true,
  data: {
    system_name: 'HYC AI',
    logo: '/hyc-mark.svg',
    theme: 'default',
    register_enabled: false,
    password_login_enabled: true,
    self_use_mode_enabled: true,
    docs_link: '/about',
    pricing_status: 'provisional',
    price: 1,
    usd_exchange_rate: 1,
    compliance: {
      source_code_url: '',
      license_notice_url: '',
      upstream_project_name: 'New API',
      upstream_project_url: 'https://github.com/QuantumNous/new-api',
      attribution_notice:
        'Frontend design and development by New API contributors.',
      license_name: 'AGPL-3.0',
    },
  },
}

const pricingPayload = {
  success: true,
  data: [
    {
      model_name: 'platform-e2e-price-source',
      quota_type: 0,
      model_ratio: 0.25,
      model_price: 0,
      completion_ratio: 2,
      enable_groups: ['default'],
      supported_endpoint_types: ['openai'],
    },
  ],
  vendors: [],
  group_ratio: { default: 1 },
  usable_group: { default: 'Default' },
  supported_endpoint: {
    openai: { path: '/v1/chat/completions', method: 'POST' },
  },
  auto_groups: ['default'],
}

async function installApiFixture(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/status') {
      await route.fulfill({ json: statusPayload })
      return
    }
    if (path === '/api/pricing') {
      await route.fulfill({ json: pricingPayload })
      return
    }
    await route.fulfill({ json: { success: true, data: null } })
  })
}

async function expectProductShell(page: Page) {
  // The TanStack Router devtools panel also renders a <footer>, so a bare
  // locator('footer') is a strict-mode violation in dev.
  const footer = page
    .locator('footer')
    .filter({ hasNotText: 'TanStack' })
    .first()
  await expect(page.getByRole('link', { name: /HYC AI/ }).first()).toBeVisible()
  await expect(page.getByText('Powered by').last()).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'New API' }).last()
  ).toHaveAttribute('href', 'https://github.com/QuantumNous/new-api')
  await expect(page.getByText('自用模式')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('© 2026 New API')
  await expect(
    footer.getByRole('link', { name: 'Documentation' })
  ).toBeVisible()
  await expect(footer.getByRole('link', { name: 'Support' })).toBeVisible()
  await expect(footer.getByRole('link', { name: 'Legal notice' })).toBeVisible()

  // Updated in Phase 4.5: with SOURCE_CODE_URL unset the footer renders
  // NOTHING here. It previously showed "Source code URL pending configuration"
  // in warning styling, which leaked deployment state to visitors and read as
  // a broken link. The AGPLv3 section 13 obligation is enforced at deploy time
  // (deploy/compose.prod.yaml requires the variable, and
  // scripts/preflight-release.ps1 fails the release), not by nagging users.
  await expect(
    footer.getByText('Source code URL pending configuration')
  ).toHaveCount(0)

  // What must never disappear is the attribution itself.
  await expect(footer).toContainText(
    'Frontend design and development by New API contributors.'
  )
}

test.beforeEach(async ({ page }) => {
  await installApiFixture(page)
})

test('auth routes render real content on direct navigation and refresh', async ({
  page,
}) => {
  await page.goto('/sign-in')
  await expect(page.getByLabel('Username or Email')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible()
  await expect(page.getByText('Route not found')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Username or Email')).toBeVisible()

  await page.goto('/sign-up')
  await expect(
    page.getByRole('heading', { name: 'Registration is currently closed' })
  ).toBeVisible()
  await expect(page.getByText('Route not found')).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Registration is currently closed' })
  ).toBeVisible()
})

test('public header, legacy routes, footer, and not-found recovery use the product shell', async ({
  page,
}) => {
  await page.goto('/')
  await expectProductShell(page)
  await expect(page).toHaveTitle(/HYC AI/)
  await page.locator('a[href^="/sign-in"]').first().click()
  await expect(page).toHaveURL(/\/sign-in/)

  await page.goto('/login')
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByLabel('Username or Email')).toBeVisible()
  await page.goto('/register')
  await expect(page).toHaveURL(/\/sign-up/)

  await page.goto('/does-not-exist-phase4')
  await expect(
    page.locator('#content').getByText('404', { exact: true })
  ).toBeVisible()
  await expect(
    page.locator('#content').getByRole('button', { name: 'Console' })
  ).toBeVisible()
  await expect(
    page.locator('#content').getByRole('button', { name: 'Sign in' })
  ).toBeVisible()
  await expectProductShell(page)

  await page.goto('/404')
  await expect(
    page.locator('#content').getByText('404', { exact: true })
  ).toBeVisible()
})

test('pricing renders the API response and no desktop template sidebar', async ({
  page,
}) => {
  let pricingRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/pricing') {
      pricingRequests += 1
    }
  })

  await page.goto('/pricing')
  await expect(page.getByText('platform-e2e-price-source')).toBeVisible()
  await expect(page.getByText('Provisional pricing')).toBeVisible()
  await expect(page.getByRole('button', { name: /Filter/ })).toBeVisible()
  await expect(
    page.locator('aside').filter({ hasText: 'All Models' })
  ).toHaveCount(0)
  expect(pricingRequests).toBeGreaterThan(0)
})

test('pricing stays bounded for 2, 20, and 100 API models', async ({
  page,
}) => {
  let modelCount = 2
  await page.route('**/api/pricing', async (route) => {
    await route.fulfill({
      json: {
        ...pricingPayload,
        data: Array.from({ length: modelCount }, (_, index) => ({
          ...pricingPayload.data[0],
          model_name: `platform-card-${index + 1}`,
        })),
      },
    })
  })

  for (const count of [2, 20, 100]) {
    modelCount = count
    await page.goto(`/pricing?fixture=${count}`)
    await expect(
      page.getByText('platform-card-1', { exact: true })
    ).toBeVisible()
    const visibleCards = await page
      .locator('h3')
      .evaluateAll(
        (headings) =>
          headings.filter((heading) =>
            heading.textContent?.startsWith('platform-card-')
          ).length
      )
    expect(visibleCards).toBe(Math.min(count, 20))
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      )
    ).toBe(false)
    if (count === 100) {
      await expect(
        page.getByRole('button', { name: 'Next page' })
      ).toBeVisible()
    }
    if (count === 2) {
      expect(
        await page.evaluate(() => document.body.scrollHeight)
      ).toBeLessThan(2400)
    }
  }
})
