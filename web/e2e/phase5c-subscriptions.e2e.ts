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
  APP_ORIGIN,
  assertLocaleApplied,
  assertThemeApplied,
  hasHorizontalOverflow,
  newAppPage,
  withRootSession,
} from './helpers/app-state'

const ARTIFACTS = path.resolve('..', 'artifacts', 'phase5c')
mkdirSync(ARTIFACTS, { recursive: true })
const now = Math.floor(Date.now() / 1000)

const user = {
  id: 7,
  username: 'subscription-owner',
  display_name: 'Subscription Owner',
  role: 10,
  status: 1,
  email: 'subscription@example.test',
  group: 'developer',
  quota: 900_000,
  used_quota: 120_000,
  request_count: 12,
  aff_quota: 0,
  aff_history_quota: 0,
  aff_count: 0,
  created_at: now - 86_400 * 30,
  created_time: now - 86_400 * 30,
  permissions: { sidebar_settings: true, admin_permissions: {} },
}

const session = {
  sid: '00000000-0000-4000-8000-000000000041',
  current: true,
  login_method: 'password',
  ip: '203.0.113.x',
  user_agent: 'HYC-E2E/phase5c',
  created_at: now - 3_600,
  last_active_at: now - 30,
  expires_at: now + 86_400,
}

const plan = {
  plan_key: 'developer-preview',
  display_name: 'Developer Preview',
  description: 'A controlled plan for lifecycle acceptance.',
  status: 'active',
  price: 1.5,
  currency: 'USD',
  billing_period: 'month',
  duration_value: 1,
  included_quota: 500_000,
  entitlements: {
    quota_pool: 'independent_period',
    allow_wallet_overflow: true,
    access_group: 'developer',
  },
  purchase_enabled: true,
  renewal_enabled: true,
}

function subscription(id = 41, state = 'active') {
  return {
    lifecycle: {
      id,
      user_subscription_id: id,
      user_id: user.id,
      plan_id: 9,
      plan_key_snapshot: 'developer-preview',
      name_zh_snapshot: '开发者预览套餐',
      name_en_snapshot: 'Developer Preview',
      price_snapshot: '1.500000',
      currency_snapshot: 'USD',
      lifecycle_state: state,
      cancel_at_period_end: state === 'canceling',
      auto_renew: false,
      renewal_attempted_at: 0,
      renewal_failure:
        state === 'renewal_failed' ? 'insufficient wallet balance' : '',
      latest_order_id: 81,
    },
    subscription: {
      id,
      user_id: user.id,
      plan_id: 9,
      status: state === 'expired' ? 'expired' : 'active',
      source: 'balance',
      start_time: now - 86_400 * 5,
      end_time: now + 86_400 * 25,
      amount_total: 500_000,
      amount_used: 125_000,
      next_reset_time: now + 86_400 * 25,
      allow_wallet_overflow: true,
      upgrade_group: 'developer',
    },
    entitlements: {
      quota_total: 500_000,
      quota_used: 125_000,
      quota_remaining: 375_000,
      quota_unlimited: false,
      allow_wallet_overflow: true,
      access_group: 'developer',
      active: state !== 'expired',
    },
  }
}

async function installSubscriptionFixture(
  page: Page,
  empty = false,
  failFirstPurchase = false
) {
  let current = empty ? [] : [subscription()]
  let purchaseCalls = 0
  const purchaseKeys: string[] = []
  let adminPlans = [
    {
      profile: {
        id: 3,
        plan_id: 9,
        plan_key: 'developer-preview',
        name_zh: '开发者预览套餐',
        name_en: 'Developer Preview',
        description_zh: '用于生命周期验收。',
        description_en: 'Lifecycle acceptance.',
        visibility: 'public',
        purchase_enabled: true,
        renewal_enabled: true,
        lifecycle_state: 'active',
        version: 1,
        archived_at: 0,
      },
      plan: {
        id: 9,
        title: 'Developer Preview',
        subtitle: '',
        price_amount: 1.5,
        currency: 'USD',
        duration_unit: 'month',
        duration_value: 1,
        quota_reset_period: 'monthly',
        enabled: true,
        sort_order: 0,
        allow_balance_pay: true,
        allow_wallet_overflow: true,
        max_purchase_per_user: 0,
        total_amount: 500_000,
      },
    },
  ]
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    const method = route.request().method()
    if (pathname === '/api/setup') {
      return route.fulfill({ json: { success: true, data: { status: true } } })
    }
    if (pathname === '/api/notice') {
      return route.fulfill({ json: { success: true, data: '' } })
    }
    if (pathname === '/api/status') {
      return route.fulfill({
        json: {
          success: true,
          data: {
            system_name: 'HYC AI',
            setup: true,
            logo: '/hyc-mark.svg',
            pricing_status: 'published',
            password_login_enabled: true,
            self_use_mode_enabled: true,
            custom_oauth_providers: [],
          },
        },
      })
    }
    if (pathname === '/api/user/auth/refresh') {
      return route.fulfill({
        json: {
          success: true,
          data: {
            access_token: 'fixture-token',
            token_type: 'Bearer',
            access_expires_at: now + 900,
            user,
            session,
          },
        },
      })
    }
    if (pathname === '/api/user/self') {
      return route.fulfill({ json: { success: true, data: user } })
    }
    if (pathname === '/api/platform/plans') {
      return route.fulfill({
        json: {
          success: true,
          data: { pricing_status: 'published', plans: [plan] },
        },
      })
    }
    if (pathname === '/api/platform/subscriptions/current') {
      return route.fulfill({
        json: {
          success: true,
          data: { pricing_status: 'published', subscriptions: current },
        },
      })
    }
    if (pathname === '/api/platform/subscriptions/history') {
      return route.fulfill({
        json: {
          success: true,
          data: { subscriptions: [...current, subscription(22, 'expired')] },
        },
      })
    }
    if (/\/api\/platform\/subscriptions\/\d+\/events$/.test(pathname)) {
      return route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 1,
              event_type: 'purchased',
              actor_type: 'user',
              created_at: now,
            },
          ],
        },
      })
    }
    if (
      pathname === '/api/platform/subscriptions/purchase' &&
      method === 'POST'
    ) {
      purchaseCalls++
      const idempotencyKey = route.request().headers()['idempotency-key']
      expect(idempotencyKey).toBeTruthy()
      purchaseKeys.push(idempotencyKey)
      if (failFirstPurchase && purchaseCalls === 1) {
        return route.fulfill({
          json: { success: false, message: 'temporary business rejection' },
        })
      }
      if (current.length === 0) current = [subscription(42)]
      await new Promise((resolve) => setTimeout(resolve, 150))
      return route.fulfill({ json: { success: true, data: current[0] } })
    }
    const cancel = pathname.match(
      /^\/api\/platform\/subscriptions\/(\d+)\/cancel$/
    )
    if (cancel && method === 'POST') {
      current = current.map((item) => ({
        ...item,
        lifecycle: {
          ...item.lifecycle,
          lifecycle_state: 'canceling',
          cancel_at_period_end: true,
          auto_renew: false,
        },
      }))
      return route.fulfill({ json: { success: true, data: current[0] } })
    }
    if (pathname.endsWith('/cancel/revoke') && method === 'POST') {
      current = current.map((item) => ({
        ...item,
        lifecycle: {
          ...item.lifecycle,
          lifecycle_state: 'active',
          cancel_at_period_end: false,
        },
      }))
      return route.fulfill({ json: { success: true, data: current[0] } })
    }
    if (pathname.endsWith('/auto-renew') && method === 'PUT') {
      const enabled = (route.request().postDataJSON() as { enabled: boolean })
        .enabled
      current = current.map((item) => ({
        ...item,
        lifecycle: { ...item.lifecycle, auto_renew: enabled },
      }))
      return route.fulfill({ json: { success: true, data: current[0] } })
    }
    if (pathname.endsWith('/renew') && method === 'POST') {
      expect(route.request().headers()['idempotency-key']).toBeTruthy()
      current = current.map((item) => ({
        ...item,
        subscription: {
          ...item.subscription,
          end_time: item.subscription.end_time + 86_400 * 30,
        },
      }))
      return route.fulfill({ json: { success: true, data: current[0] } })
    }
    if (
      pathname === '/api/platform/admin/subscriptions/plans' &&
      method === 'GET'
    ) {
      return route.fulfill({
        json: {
          success: true,
          data: { pricing_status: 'published', plans: adminPlans },
        },
      })
    }
    if (
      pathname === '/api/platform/admin/subscriptions/plans' &&
      method === 'POST'
    ) {
      const body = route.request().postDataJSON() as {
        profile: Record<string, unknown>
        plan: Record<string, unknown>
      }
      adminPlans = [
        ...adminPlans,
        {
          profile: {
            ...body.profile,
            id: 4,
            plan_id: 10,
            version: 1,
            archived_at: 0,
          },
          plan: { ...adminPlans[0].plan, ...body.plan, id: 10 },
        },
      ]
      return route.fulfill({
        json: { success: true, data: adminPlans.at(-1) },
      })
    }
    if (
      /\/api\/platform\/admin\/subscriptions\/plans\/\d+$/.test(pathname) &&
      method === 'PUT'
    ) {
      const body = route.request().postDataJSON()
      adminPlans = adminPlans.map((item) =>
        item.profile.id === body.profile.id ? body : item
      )
      return route.fulfill({ json: { success: true, data: body } })
    }
    if (
      /\/api\/platform\/admin\/subscriptions\/plans\/\d+$/.test(pathname) &&
      method === 'DELETE'
    ) {
      return route.fulfill({ json: { success: true, data: null } })
    }
    if (pathname === '/api/platform/admin/subscriptions' && method === 'GET') {
      return route.fulfill({ json: { success: true, data: current } })
    }
    if (
      /\/api\/platform\/admin\/subscriptions\/\d+$/.test(pathname) &&
      method === 'GET'
    ) {
      return route.fulfill({
        json: {
          success: true,
          data: {
            subscription: current[0],
            events: [
              {
                id: 1,
                event_type: 'activated',
                actor_type: 'system',
                created_at: now,
              },
            ],
          },
        },
      })
    }
    if (pathname === '/api/platform/admin/subscriptions/reconcile') {
      return route.fulfill({
        json: { success: true, data: { renewal_attempts: 0, reconciled: 0 } },
      })
    }
    return route.fulfill({ json: { success: true, data: [] } })
  })
  return {
    purchaseCalls: () => purchaseCalls,
    purchaseKeys: () => purchaseKeys,
  }
}

test('user subscription lifecycle actions use live API state and idempotency', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    theme: 'light',
    locale: 'en',
    viewport: { width: 1440, height: 900 },
  })
  const fixture = await installSubscriptionFixture(page, true)
  await page.goto('/my-subscription')
  await expect(page.getByText('No active subscription')).toBeVisible()
  await page.getByRole('button', { name: 'Purchase with Wallet' }).dblclick()
  await expect(page.getByText('Developer Preview').first()).toBeVisible()
  expect(fixture.purchaseCalls()).toBe(1)
  await page.getByRole('switch').click()
  await expect(page.getByRole('switch')).toBeChecked()
  await page.getByRole('button', { name: 'Cancel at period end' }).click()
  await expect(page.getByText('Cancels at period end')).toBeVisible()
  await page.getByRole('button', { name: 'Resume subscription' }).click()
  await expect(page.getByText('Active', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Renew now' }).click()
  await expect(page.getByText('Subscription history')).toBeVisible()
  await page.getByRole('button', { name: 'Events' }).first().click()
  await expect(page.getByText('purchased', { exact: true })).toBeVisible()
})

test('business failure envelopes do not show success and retries retain idempotency', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    theme: 'light',
    locale: 'en',
    viewport: { width: 1440, height: 900 },
  })
  const fixture = await installSubscriptionFixture(page, true, true)
  await page.goto('/my-subscription')
  const purchase = page.getByRole('button', { name: 'Purchase with Wallet' })
  await purchase.click()
  await expect(page.getByText('Request failed')).toBeVisible()
  await expect(page.getByText('No active subscription')).toBeVisible()
  await purchase.click()
  await expect(page.getByText('Developer Preview').first()).toBeVisible()
  expect(fixture.purchaseCalls()).toBe(2)
  expect(fixture.purchaseKeys()[0]).toBe(fixture.purchaseKeys()[1])
})

test('subscription user page has no horizontal overflow across viewport, theme, and locale matrix', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    for (const theme of ['light', 'dark'] as const) {
      for (const locale of ['en', 'zhCN'] as const) {
        const page = await newAppPage(browser, { viewport, theme, locale })
        await installSubscriptionFixture(page)
        await page.goto('/my-subscription')
        await expect(
          page.getByRole('heading', {
            name: locale === 'en' ? 'My subscription' : '我的订阅',
            exact: true,
          })
        ).toBeVisible()
        await assertThemeApplied(page, theme)
        // The authenticated sidebar (the helper's locale marker surface) is
        // intentionally absent below the md breakpoint. The localized page
        // heading above is the mobile assertion; use the shared two-way
        // console marker whenever the sidebar is rendered.
        if (viewport.width >= 768) {
          await assertLocaleApplied(page, locale, 'console')
        }
        expect(await hasHorizontalOverflow(page)).toBe(false)
        await page.screenshot({
          path: path.join(
            ARTIFACTS,
            `user-${viewport.width}x${viewport.height}-${theme}-${locale}.png`
          ),
          fullPage: true,
        })
        await page.context().close()
      }
    }
  }
})

test('administrator can create a disabled draft and inspect lifecycle events', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    theme: 'dark',
    locale: 'en',
    viewport: { width: 1440, height: 900 },
  })
  await installSubscriptionFixture(page)
  await page.goto('/subscriptions')
  // `exact` matters: the empty state reads "No product subscription plans",
  // which this substring also matches, so the assertion becomes a strict-mode
  // violation whenever the plan list happens to be empty — which depends on
  // what earlier tests in the run left behind.
  await expect(
    page.getByText('Product subscription plans', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create plan', exact: true }).click()
  await page.getByLabel('Plan key').fill('team-preview')
  await page.getByLabel('English name').fill('Team Preview')
  await page.getByLabel('Chinese name').fill('团队预览套餐')
  await page.getByRole('button', { name: 'Create disabled draft' }).click()
  await expect(page.getByText('Team Preview')).toBeVisible()
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Price (USD)').fill('2.25')
  await page.getByLabel('Quota').fill('650000')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('$2.25 USD')).toBeVisible()
  await page.getByRole('button', { name: 'Events' }).first().click()
  await expect(page.getByText('activated', { exact: true })).toBeVisible()
  await page.screenshot({
    path: path.join(ARTIFACTS, 'admin-1440x900-dark-en.png'),
    fullPage: true,
  })
})

test.describe('live Phase 5C subscription boundary', () => {
  test.skip(
    process.env.HYC_LIVE_E2E !== '1' || !process.env.HYC_LIVE_PASSWORD,
    'Set HYC_LIVE_E2E=1 and HYC_LIVE_PASSWORD for live subscription verification.'
  )

  test('authenticated lifecycle reads succeed and provisional purchase fails closed', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, {
      locale: 'en',
      theme: 'light',
      sessionTag: 'phase5c-subscription-live',
    })
    await withRootSession(
      page,
      process.env.HYC_LIVE_PASSWORD ?? '',
      async ({ accessToken }) => {
        const headers = { Authorization: `Bearer ${accessToken}` }
        const current = await page.request.get(
          `${APP_ORIGIN}/api/platform/subscriptions/current`,
          { headers }
        )
        expect(current.ok()).toBe(true)
        expect((await current.json()).success).toBe(true)

        const history = await page.request.get(
          `${APP_ORIGIN}/api/platform/subscriptions/history`,
          { headers }
        )
        expect(history.ok()).toBe(true)
        expect((await history.json()).success).toBe(true)

        const purchase = await page.request.post(
          `${APP_ORIGIN}/api/platform/subscriptions/purchase`,
          {
            headers: {
              ...headers,
              'Idempotency-Key': 'phase5c-live-provisional-guard',
            },
            data: { plan_key: 'must-not-be-looked-up' },
          }
        )
        const purchaseBody = await purchase.json()
        expect(purchaseBody.success).toBe(false)
        expect(purchaseBody.message).toContain('pricing is provisional')
      }
    )
    await page.context().close()
  })
})
