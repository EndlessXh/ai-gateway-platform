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
  assertLocaleApplied,
  assertThemeApplied,
  cleanupTestSession,
  cleanupStaleDevSessions,
  hasHorizontalOverflow,
  newAppPage,
  resetDevRateLimits,
  signInAsRoot,
  withRootSession,
} from './helpers/app-state'

const ARTIFACTS = path.resolve('..', 'artifacts', 'phase5b')
mkdirSync(ARTIFACTS, { recursive: true })

const now = Math.floor(Date.now() / 1000)
const user = {
  id: 7,
  username: 'wallet-owner',
  display_name: 'Gateway Operator',
  role: 1,
  status: 1,
  email: 'operator@example.test',
  group: 'default',
  quota: 4_000_000,
  used_quota: 1_500_000,
  request_count: 27,
  aff_quota: 0,
  aff_history_quota: 0,
  aff_count: 0,
  created_at: now - 86_400 * 30,
  created_time: now - 86_400 * 30,
  permissions: { sidebar_settings: true, admin_permissions: {} },
}

const session = {
  sid: '00000000-0000-4000-8000-000000000001',
  current: true,
  login_method: 'password',
  ip: '203.0.113.x',
  user_agent: 'Mozilla/5.0 Chrome/140 Windows NT 10.0',
  created_at: now - 3_600,
  last_active_at: now - 30,
  expires_at: now + 86_400,
}

async function installAccountFixture(
  page: Page,
  options: {
    failWalletSources?: boolean
    failProfileRefreshAfterUpdate?: boolean
  } = {}
) {
  const profileUser = { ...user }
  let profileUpdated = false
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    if (pathname === '/api/setup') {
      await route.fulfill({ json: { success: true, data: { status: true } } })
      return
    }
    if (pathname === '/api/notice') {
      await route.fulfill({ json: { success: true, data: '' } })
      return
    }
    if (pathname === '/api/status') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            system_name: 'HYC AI',
            setup: true,
            logo: '/hyc-mark.svg',
            pricing_status: 'provisional',
            price: 1,
            quota_display_type: 'USD',
            quota_per_unit: 500000,
            password_login_enabled: true,
            self_use_mode_enabled: true,
            custom_oauth_providers: [],
          },
        },
      })
      return
    }
    if (pathname === '/api/user/auth/refresh') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            access_token: 'fixture-access-token',
            token_type: 'Bearer',
            access_expires_at: now + 900,
            user: profileUser,
            session,
          },
        },
      })
      return
    }
    if (pathname === '/api/user/self') {
      if (route.request().method() === 'PUT') {
        const update = route.request().postDataJSON() as {
          display_name?: string
        }
        if (typeof update.display_name === 'string') {
          profileUser.display_name = update.display_name
        }
        profileUpdated = true
        await route.fulfill({ json: { success: true, data: profileUser } })
        return
      }
      if (options.failProfileRefreshAfterUpdate && profileUpdated) {
        await route.fulfill({
          status: 503,
          json: { success: false, message: 'fixture refresh unavailable' },
        })
        return
      }
      if (options.failWalletSources) {
        await route.fulfill({
          status: 503,
          json: { success: false, message: 'fixture source unavailable' },
        })
        return
      }
      await route.fulfill({ json: { success: true, data: profileUser } })
      return
    }
    if (pathname === '/api/user/topup/info') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            enable_online_topup: false,
            enable_stripe_topup: false,
            enable_redemption: true,
            pay_methods: [],
            min_topup: 1,
            stripe_min_topup: 1,
            amount_options: [],
            discount: {},
            payment_compliance_confirmed: true,
          },
        },
      })
      return
    }
    if (pathname === '/api/log/self/stat') {
      if (options.failWalletSources) {
        await route.fulfill({ status: 503, json: { success: false } })
        return
      }
      await route.fulfill({ json: { success: true, data: { quota: 250000 } } })
      return
    }
    if (pathname === '/api/log/self') {
      if (options.failWalletSources) {
        await route.fulfill({ status: 503, json: { success: false } })
        return
      }
      await route.fulfill({
        json: {
          success: true,
          data: {
            total: 2,
            items: [
              {
                id: 1,
                created_at: now - 120,
                model_name: 'platform-general-chat',
                quota: 150000,
                is_stream: true,
                request_id: 'fixture-request',
              },
            ],
          },
        },
      })
      return
    }
    if (pathname === '/api/user/topup/self') {
      if (options.failWalletSources) {
        await route.fulfill({ status: 503, json: { success: false } })
        return
      }
      await route.fulfill({
        json: {
          success: true,
          data: {
            total: 1,
            items: [
              {
                id: 1,
                user_id: user.id,
                amount: 500000,
                money: 1,
                trade_no: 'fixture-topup',
                payment_method: 'redemption',
                create_time: now - 600,
                status: 'success',
              },
            ],
          },
        },
      })
      return
    }
    if (pathname === '/api/user/sessions') {
      await route.fulfill({
        json: {
          success: true,
          data: [
            session,
            {
              ...session,
              sid: '00000000-0000-4000-8000-000000000002',
              current: false,
              login_method: 'github',
              ip: '198.51.100.x',
              user_agent: 'Mozilla/5.0 Safari/18 Mac OS X',
            },
          ],
        },
      })
      return
    }
    if (pathname === '/api/user/passkey/status') {
      await route.fulfill({ json: { success: true, data: { enabled: false } } })
      return
    }
    if (pathname === '/api/user/2fa/status') {
      await route.fulfill({
        json: { success: true, data: { enabled: false, locked: false } },
      })
      return
    }
    if (pathname === '/api/user/oauth/bindings') {
      await route.fulfill({ json: { success: true, data: [] } })
      return
    }
    await route.fulfill({ json: { success: true, data: [] } })
  })
}

test('profile edit persists and synchronizes the authenticated shell', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    locale: 'en',
  })
  await installAccountFixture(page)
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Edit profile' }).click()
  await page.getByLabel('Display name').fill('   ')
  await expect(
    page.getByRole('button', { name: 'Save changes', exact: true })
  ).toBeDisabled()
  await page.getByLabel('Display name').fill('Updated Operator')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Profile updated successfully')).toBeVisible()
  await expect(page.getByText('Updated Operator').first()).toBeVisible()

  await page.getByRole('button', { name: 'Open profile menu' }).click()
  await expect(page.getByText('Updated Operator').last()).toBeVisible()
  await page.reload()
  await expect(page.getByText('Updated Operator').first()).toBeVisible()
  await page.context().close()
})

test('wallet source failures never render a fabricated zero balance', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    viewport: { width: 1440, height: 900 },
    theme: 'dark',
    locale: 'en',
  })
  await installAccountFixture(page, { failWalletSources: true })
  await page.goto('/wallet')
  await expect(page.getByText('Wallet balance is unavailable')).toBeVisible()
  await expect(
    page.getByText(
      'Some account activity could not be refreshed. Unavailable values are not shown as zero.'
    )
  ).toBeVisible()
  await expect(
    page.getByText('Credit / remaining quota', { exact: true })
  ).toHaveCount(0)
  await page.context().close()
})

test('profile edit remains synchronized when the confirmation refresh fails', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    locale: 'en',
  })
  await installAccountFixture(page, { failProfileRefreshAfterUpdate: true })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Edit profile' }).click()
  await page.getByLabel('Display name').fill('Confirmed Operator')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Profile updated successfully')).toBeVisible()
  await expect(page.getByText('Profile refresh incomplete')).toBeVisible()
  await expect(page.getByText('Confirmed Operator').first()).toBeVisible()
  await page.getByRole('button', { name: 'Open profile menu' }).click()
  await expect(page.getByText('Confirmed Operator').last()).toBeVisible()
  await page.context().close()
})

test('sign out everywhere clears the authenticated shell', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    locale: 'en',
  })
  await installAccountFixture(page)
  await page.goto('/profile')
  await page
    .getByRole('button', { name: 'Sign out everywhere', exact: true })
    .click()
  const dialog = page.getByRole('alertdialog', {
    name: 'Sign out every session?',
  })
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: 'Sign out everywhere', exact: true })
    .click()
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
  await page.context().close()
})

for (const viewport of [
  { width: 390, height: 844, name: 'mobile' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' },
]) {
  for (const theme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'zhCN'] as const) {
      test(`account console ${viewport.name} ${theme} ${locale}`, async ({
        browser,
      }) => {
        const page = await newAppPage(browser, { viewport, theme, locale })
        await installAccountFixture(page)
        await page.goto('/wallet')
        await expect(
          page.getByText(locale === 'zhCN' ? '账户动态' : 'Account activity')
        ).toBeVisible()
        await expect(page.getByText('platform-general-chat')).toBeVisible()
        await assertThemeApplied(page, theme)
        await assertLocaleApplied(page, locale, 'console')
        expect(await hasHorizontalOverflow(page)).toBe(false)

        await page.goto('/profile')
        await expect(
          page.getByText(locale === 'zhCN' ? '基本资料' : 'Basic profile')
        ).toBeVisible()
        await expect(page.getByText('203.0.113.x')).toBeVisible()
        await expect(page.getByText(/203\.0\.113\.42/)).toHaveCount(0)
        expect(await hasHorizontalOverflow(page)).toBe(false)

        if (
          (viewport.name === 'mobile' &&
            theme === 'dark' &&
            locale === 'zhCN') ||
          (viewport.name === 'desktop' && theme === 'light' && locale === 'en')
        ) {
          await page.screenshot({
            path: path.join(
              ARTIFACTS,
              `account-${viewport.name}-${theme}-${locale}.png`
            ),
            fullPage: true,
          })
        }
        await page.context().close()
      })
    }
  }
}

test.describe('live Phase 5B account console', () => {
  test.skip(
    process.env.HYC_LIVE_E2E !== '1' || !process.env.HYC_LIVE_PASSWORD,
    'Set HYC_LIVE_E2E=1 and HYC_LIVE_PASSWORD for live account verification.'
  )

  test.beforeAll(() => {
    cleanupStaleDevSessions()
    resetDevRateLimits()
  })

  test('wallet, profile, and session list use live authenticated data', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, {
      locale: 'en',
      theme: 'light',
      sessionTag: 'phase5b-account-live',
    })
    await withRootSession(
      page,
      process.env.HYC_LIVE_PASSWORD ?? '',
      async ({ sid, accessToken }) => {
        await page.goto('/wallet')
        await expect(page.getByText('Account activity')).toBeVisible()
        await expect(page.getByText('Pricing is provisional')).toBeVisible()
        await page.screenshot({
          path: path.join(ARTIFACTS, 'wallet-live-desktop-en.png'),
          fullPage: true,
        })

        await page.goto('/profile')
        await expect(page.getByText('Basic profile')).toBeVisible()
        await expect(page.getByText('Login sessions')).toBeVisible()
        await expect(page.getByText('Current', { exact: true })).toBeVisible()
        await page.screenshot({
          path: path.join(ARTIFACTS, 'profile-live-desktop-en.png'),
          fullPage: true,
        })

        const displayNameInput = page.getByLabel('Display name')
        const originalDisplayName = await displayNameInput.inputValue()
        let profileChanged = false
        try {
          await page.getByRole('button', { name: 'Edit profile' }).click()
          await displayNameInput.fill('Phase5B Verified')
          const updateResponse = page.waitForResponse(
            (response) =>
              response.url().includes('/api/user/self') &&
              response.request().method() === 'PUT'
          )
          await page
            .getByRole('button', { name: 'Save changes', exact: true })
            .click()
          profileChanged = (await updateResponse).ok()
          await expect(displayNameInput).toHaveValue('Phase5B Verified')
          await page.getByRole('button', { name: 'Open profile menu' }).click()
          await expect(page.getByText('Phase5B Verified').last()).toBeVisible()
          await page.reload()
          await expect(displayNameInput).toHaveValue('Phase5B Verified')
        } finally {
          if (profileChanged) {
            await page.goto('/profile')
            await page.getByRole('button', { name: 'Edit profile' }).click()
            await displayNameInput.fill(originalDisplayName)
            await page
              .getByRole('button', { name: 'Save changes', exact: true })
              .click()
            await expect(displayNameInput).toHaveValue(originalDisplayName)
          }
        }

        const extraPage = await newAppPage(browser, {
          locale: 'en',
          theme: 'light',
          sessionTag: 'phase5b-extra-session',
        })
        let extraSession: Awaited<ReturnType<typeof signInAsRoot>> | null = null
        try {
          extraSession = await signInAsRoot(
            extraPage,
            process.env.HYC_LIVE_PASSWORD ?? ''
          )
          const sessionHeaders = {
            Authorization: `Bearer ${accessToken}`,
            'X-Auth-Session': sid,
          }
          const before = await page.request.get('/api/user/sessions', {
            headers: sessionHeaders,
          })
          expect(before.ok()).toBe(true)
          const beforeBody = await before.json()
          expect(
            beforeBody.data.some(
              (entry: { sid: string }) => entry.sid === extraSession?.sid
            )
          ).toBe(true)

          const revoked = await page.request.delete(
            `/api/user/sessions/${extraSession.sid}`,
            { headers: sessionHeaders }
          )
          expect(revoked.ok()).toBe(true)
          const after = await page.request.get('/api/user/sessions', {
            headers: sessionHeaders,
          })
          const afterBody = await after.json()
          expect(
            afterBody.data.some(
              (entry: { sid: string }) => entry.sid === extraSession?.sid
            )
          ).toBe(false)
        } finally {
          if (extraSession) {
            await cleanupTestSession(extraPage, extraSession.sid).catch(
              () => undefined
            )
          }
          await extraPage.context().close()
        }
      }
    )
    await page.context().close()
  })
})
