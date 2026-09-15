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
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import {
  E2E_RUN_ID,
  assertLocaleApplied,
  assertThemeApplied,
  cleanupStaleDevSessions,
  hasHorizontalOverflow,
  newAppPage,
  resetDevRateLimits,
  withRootSession,
  type Locale,
} from './helpers/app-state'

const ARTIFACTS = path.resolve('..', 'artifacts', 'phase5a')
mkdirSync(ARTIFACTS, { recursive: true })

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

function catalogItems(count: number, locale: Locale = 'en') {
  return Array.from({ length: count }, (_, index) => ({
    public_model_id: `platform-catalog-model-${String(index + 1).padStart(3, '0')}-preview`,
    display_name:
      locale === 'zhCN'
        ? `平台目录模型 ${index + 1}`
        : `Platform Catalog Model ${index + 1}`,
    provider_label: locale === 'zhCN' ? '平台路由' : 'Platform routing',
    description:
      locale === 'zhCN'
        ? '由目录 API 返回的中性平台模型描述。'
        : 'A neutral platform model description returned by the catalog API.',
    category: index % 2 === 0 ? 'general' : 'reasoning',
    capabilities:
      index % 2 === 0 ? ['chat', 'streaming'] : ['chat', 'reasoning'],
    input_modalities: ['text'],
    output_modalities: ['text'],
    context_label: '',
    icon_key: index % 2 === 0 ? 'platform' : 'brain',
    badge: 'preview',
    availability_status: index === 1 ? 'maintenance' : 'preview',
    recommended: index === 0,
    api_enabled: true,
    pricing: {
      status: 'configured',
      quota_type: 0,
      model_ratio: 0.2 + index / 100,
      completion_ratio: 2,
      model_price: 0,
    },
    pricing_status: 'configured',
    route_availability: index === 2 ? 'no_active_route' : 'available',
    sort_order: index * 10,
  }))
}

function pricingPayload(items: ReturnType<typeof catalogItems>) {
  return {
    success: true,
    data: items.map((item, index) => ({
      model_name: item.public_model_id,
      display_name: item.display_name,
      provider_label: item.provider_label,
      description: item.description,
      category: item.category,
      capabilities: item.capabilities,
      input_modalities: item.input_modalities,
      output_modalities: item.output_modalities,
      context_label: item.context_label,
      icon_key: item.icon_key,
      badge_key: item.badge,
      availability_status: item.availability_status,
      recommended: item.recommended,
      api_enabled: item.api_enabled,
      platform_pricing_status: item.pricing_status,
      route_availability: item.route_availability,
      quota_type: 0,
      model_ratio: item.pricing.model_ratio,
      model_price: 0,
      completion_ratio: 2,
      enable_groups: ['default'],
      supported_endpoint_types: ['openai'],
      id: index + 1,
    })),
    vendors: [],
    group_ratio: { default: 1 },
    usable_group: { default: 'Default' },
    supported_endpoint: {
      openai: { path: '/v1/chat/completions', method: 'POST' },
    },
    auto_groups: ['default'],
  }
}

async function installCatalogFixture(
  page: Page,
  options: { count?: number; locale?: Locale; catalogStatus?: number } = {}
) {
  const items = catalogItems(options.count ?? 2, options.locale)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/status') {
      await route.fulfill({ json: statusPayload })
      return
    }
    if (url.pathname === '/api/platform/models') {
      if (options.catalogStatus && options.catalogStatus !== 200) {
        await route.fulfill({
          status: options.catalogStatus,
          json: { success: false, message: 'fixture error' },
        })
        return
      }
      await route.fulfill({
        json: { success: true, message: '', data: items },
      })
      return
    }
    if (url.pathname === '/api/pricing') {
      await route.fulfill({ json: pricingPayload(items) })
      return
    }
    await route.fulfill({ json: { success: true, data: null } })
  })
}

for (const viewport of [
  { width: 390, height: 844, name: 'mobile' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' },
]) {
  for (const theme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'zhCN'] as const) {
      test(`catalog ${viewport.name} ${theme} ${locale}`, async ({
        browser,
      }) => {
        const page = await newAppPage(browser, { viewport, theme, locale })
        await installCatalogFixture(page, { locale })
        await page.goto('/model-catalog')
        await expect(
          page.getByRole('heading', {
            // Round 4 renamed this page to "Model Square" / 模型广场; "模型"
            // was ambiguous against the pricing page's model list.
            name: locale === 'zhCN' ? '模型广场' : 'Model Square',
            exact: true,
          })
        ).toBeVisible()
        await assertThemeApplied(page, theme)
        await assertLocaleApplied(page, locale)
        await expect(page.getByTestId('full-model-id').first()).toContainText(
          'platform-catalog-model-001-preview'
        )
        await expect(
          page.getByRole('button', {
            name: new RegExp('platform-catalog-model-001-preview'),
          })
        ).toBeVisible()
        expect(await hasHorizontalOverflow(page)).toBe(false)
        if (viewport.name === 'mobile' && theme === 'dark') {
          await page.screenshot({
            path: path.join(
              ARTIFACTS,
              `catalog-${viewport.name}-${theme}-${locale}.png`
            ),
            fullPage: true,
          })
        }
        await page.context().close()
      })
    }
  }
}

test('catalog search, filters, states, and Pricing metadata stay aligned', async ({
  page,
}) => {
  await installCatalogFixture(page)
  await page.goto('/model-catalog')
  await page.getByLabel('Search models').fill('model-002')
  await expect(page.getByText('Platform Catalog Model 2')).toBeVisible()
  await expect(page.getByText('Platform Catalog Model 1')).toHaveCount(0)
  await page.getByLabel('Search models').fill('not-present')
  await expect(
    page.getByRole('heading', { name: 'No models match these filters' })
  ).toBeVisible()

  await page.goto('/pricing')
  await expect(page.getByText('Platform Catalog Model 1')).toBeVisible()
  await expect(
    page
      .getByText(
        'A neutral platform model description returned by the catalog API.'
      )
      .first()
  ).toBeVisible()
})

// The catalogue pages at 12 cards per view, so a large result set is no longer
// rendered in one block. The contract worth asserting is therefore: the total
// count still reflects every match, the grid renders a full page (never more),
// and the layout stays within the viewport at any catalogue size.
const CATALOG_PAGE_SIZE = 12

for (const count of [2, 20, 100]) {
  test(`catalog keeps ${count} model cards responsive`, async ({ page }) => {
    await installCatalogFixture(page, { count })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/model-catalog')

    await expect(page.getByText(`${count} models`)).toBeVisible()

    const expectedOnPage = Math.min(count, CATALOG_PAGE_SIZE)
    await expect(page.getByTestId('full-model-id')).toHaveCount(expectedOnPage)

    // Pagination must appear exactly when the result set exceeds one page.
    const pagination = page.getByRole('navigation', { name: 'Pagination' })
    if (count > CATALOG_PAGE_SIZE) {
      await expect(pagination).toBeVisible()

      // Advancing must actually change the rendered page rather than being a
      // decorative control.
      const firstId = await page
        .getByTestId('full-model-id')
        .first()
        .innerText()
      await page.getByRole('button', { name: 'Next' }).click()
      await expect(page.getByTestId('full-model-id').first()).not.toHaveText(
        firstId
      )
    } else {
      await expect(pagination).toHaveCount(0)
    }

    expect(await hasHorizontalOverflow(page)).toBe(false)
  })
}

test('catalog exposes a recoverable API error state', async ({ page }) => {
  await installCatalogFixture(page, { catalogStatus: 503 })
  await page.goto('/model-catalog')
  /*
    The retry policy in main.tsx differs by build: development returns false on
    the first failure, production retries until failureCount > 3. Against a
    production bundle the 503 therefore takes four attempts plus exponential
    backoff — comfortably more than the 5s default — before React Query exposes
    the error and this state renders. The wait is sized to the retry chain
    rather than the policy being weakened to suit the test.
  */
  await expect(page.getByText('Model catalog could not be loaded')).toBeVisible(
    { timeout: 20_000 }
  )
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible()
})

test.describe('live catalog administration', () => {
  test.skip(
    process.env.HYC_LIVE_E2E !== '1' || !process.env.HYC_LIVE_PASSWORD,
    'Set HYC_LIVE_E2E=1 and HYC_LIVE_PASSWORD for live catalog CRUD.'
  )

  test.beforeAll(() => {
    resetDevRateLimits()
    cleanupStaleDevSessions()
  })

  test('live public catalog and Playground use the real catalog metadata', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const publicPage = await newAppPage(browser, {
      theme: 'dark',
      locale: 'zhCN',
      viewport: { width: 390, height: 844 },
    })
    await publicPage.goto('/model-catalog')
    await assertThemeApplied(publicPage, 'dark')
    await assertLocaleApplied(publicPage, 'zhCN')
    await expect(
      publicPage.getByText('platform-general-preview', { exact: true })
    ).toBeVisible()
    await expect(
      publicPage.getByText('platform-reasoning-preview', { exact: true })
    ).toBeVisible()
    expect(await hasHorizontalOverflow(publicPage)).toBe(false)
    await publicPage.screenshot({
      path: path.join(ARTIFACTS, 'live-catalog-mobile-dark-zhCN.png'),
      fullPage: true,
    })
    await publicPage.context().close()

    const playgroundPage = await newAppPage(browser, {
      theme: 'light',
      locale: 'en',
      viewport: { width: 768, height: 1024 },
      sessionTag: 'phase5a-live-playground',
    })
    const password = process.env.HYC_LIVE_PASSWORD ?? ''
    await withRootSession(playgroundPage, password, async () => {
      await playgroundPage.goto('/playground')
      await assertThemeApplied(playgroundPage, 'light')
      await assertLocaleApplied(playgroundPage, 'en', 'console')
      await expect(
        playgroundPage.getByRole('combobox').filter({
          hasText: 'Platform General Preview',
        })
      ).toBeVisible({ timeout: 30_000 })
      expect(await hasHorizontalOverflow(playgroundPage)).toBe(false)
      await playgroundPage.screenshot({
        path: path.join(ARTIFACTS, 'live-playground-tablet-light-en.png'),
        fullPage: true,
      })
    })
    await playgroundPage.context().close()
  })

  test('administrator creates, edits, disables, diagnoses, and archives a catalog model', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, {
      theme: 'dark',
      locale: 'en',
      viewport: { width: 1440, height: 900 },
      sessionTag: 'phase5a-catalog-crud',
    })
    const password = process.env.HYC_LIVE_PASSWORD ?? ''
    const id = `platform-phase5a-${E2E_RUN_ID.toLowerCase()}-preview`.slice(
      0,
      120
    )
    await withRootSession(page, password, async () => {
      let created = false
      try {
        await page.goto('/models/catalog')
        await expect(
          page.getByRole('button', { name: 'Create catalog model' })
        ).toBeVisible()
        await page.getByRole('button', { name: 'Create catalog model' }).click()
        await page.getByLabel('Public model ID').fill(id)
        await page.getByLabel('Display name').fill('Phase 5A E2E model')
        await page
          .getByLabel('English description')
          .fill('A temporary catalog administration test model.')
        await page
          .getByLabel('Chinese description')
          .fill('用于目录管理测试的临时模型。')
        await page.getByRole('button', { name: 'Save' }).click()
        const catalogRow = page.getByRole('row').filter({ hasText: id })
        await expect(
          catalogRow.getByText('Phase 5A E2E model', { exact: true })
        ).toBeVisible()
        created = true
        await expect(catalogRow.getByText('No active route')).toBeVisible()
        await expect(catalogRow.getByText('Unavailable')).toBeVisible()

        await page.getByRole('button', { name: `Edit ${id}` }).click()
        await page.getByLabel('Display name').fill('Phase 5A E2E model edited')
        await page.getByLabel('Availability status').selectOption('maintenance')
        await page.getByRole('button', { name: 'Save' }).click()
        await expect(
          catalogRow.getByText('Phase 5A E2E model edited', { exact: true })
        ).toBeVisible()
        await expect(
          catalogRow.getByText('Maintenance', { exact: true })
        ).toBeVisible()
        await page.screenshot({
          path: path.join(ARTIFACTS, 'admin-catalog-desktop-dark-en.png'),
          fullPage: true,
        })

        await page.getByRole('button', { name: `Archive ${id}` }).click()
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(catalogRow).toHaveCount(0)
        created = false
      } finally {
        if (created) {
          await page.goto('/models/catalog')
          const archiveButton = page.getByRole('button', {
            name: `Archive ${id}`,
          })
          if ((await archiveButton.count()) > 0) {
            await archiveButton.click()
            await page.getByRole('button', { name: 'Continue' }).click()
          }
        }
      }
    })
    await page.context().close()
  })
})
