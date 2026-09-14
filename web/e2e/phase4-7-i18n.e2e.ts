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
import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  APP_ORIGIN,
  assertLocaleApplied,
  assertThemeApplied,
  findRawI18nKeys,
  hasHorizontalOverflow,
  newAppPage,
  productFooter,
} from './helpers/app-state'

const ARTIFACTS = path.resolve('..', 'artifacts', 'phase4-7')

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACTS, { recursive: true })
})

const COPY = {
  en: {
    // Below-fold home copy. 'Streaming responses' and 'Extensible channel
    // layer' were retired when the uniform six-cell feature grid became
    // composite panels plus a supporting row; these cover the same stretch of
    // the page.
    home: [
      'Unified AI API infrastructure',
      'Built for developers, observable end to end',
      'Compatible request formats',
      'Routing architecture',
      'Open to extension',
    ],
    pricing: ['Backend-sourced model rates', 'Model pricing'],
    auth: [
      'Gateway access',
      'Credentials are the control plane for every request.',
    ],
    notFound: ['Route not found', 'This page is not part of the gateway.'],
    footer: ['Documentation', 'Support', 'Legal notice'],
    description:
      'A unified AI API gateway for model routing, access control, usage logs, and quota visibility.',
  },
  zhCN: {
    home: [
      '统一 AI API 基础设施',
      '为开发者打造，全程可观测',
      '兼容请求格式',
      '路由架构',
      '开放扩展',
    ],
    pricing: ['价格来自网关后端', '模型定价'],
    auth: ['网关访问', '用凭据管理每一次请求。'],
    notFound: ['未找到页面', '网关中不存在此页面。'],
    footer: ['文档', '支持', '法律信息'],
    description:
      '统一的 AI API 网关，集中提供模型路由、访问控制、使用日志与额度统计。',
  },
} as const

for (const locale of ['en', 'zhCN'] as const) {
  test(`home, pricing, auth, footer, and 404 render complete ${locale} copy`, async ({
    browser,
  }) => {
    const page = await newAppPage(browser, {
      locale,
      theme: locale === 'zhCN' ? 'dark' : 'light',
      viewport: { width: 1440, height: 900 },
    })
    const expected = COPY[locale]
    const opposite = COPY[locale === 'en' ? 'zhCN' : 'en']

    for (const [route, present, absent] of [
      ['/', expected.home, opposite.home],
      ['/pricing', expected.pricing, opposite.pricing],
      ['/sign-in', expected.auth, opposite.auth],
      ['/404', expected.notFound, opposite.notFound],
    ] as const) {
      await page.goto(`${APP_ORIGIN}${route}`)
      await page.waitForLoadState('networkidle')
      await assertLocaleApplied(page, locale)
      for (const text of present) {
        await expect(page.getByText(text).first()).toBeVisible()
      }
      for (const text of absent) {
        await expect(page.getByText(text)).toHaveCount(0)
      }
      expect(await findRawI18nKeys(page)).toHaveLength(0)
      expect(await hasHorizontalOverflow(page)).toBe(false)
    }

    await page.goto(`${APP_ORIGIN}/`)
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      expected.description
    )
    const footer = productFooter(page)
    for (const text of expected.footer) {
      await expect(footer.getByText(text, { exact: true })).toBeVisible()
    }
    for (const text of opposite.footer) {
      await expect(footer.getByText(text, { exact: true })).toHaveCount(0)
    }
    await expect(footer).toContainText('New API')
    await expect(page.locator('body')).toContainText('/v1')
    await expect(page.locator('body')).toContainText('platform-general-preview')

    await page.reload()
    await page.waitForLoadState('networkidle')
    await assertLocaleApplied(page, locale)
    await page.goto(`${APP_ORIGIN}/sign-in`)
    await assertLocaleApplied(page, locale)
    await page.context().close()
  })
}

test('representative locale/theme/viewport evidence remains truthful', async ({
  browser,
}) => {
  for (const item of [
    {
      route: '/',
      name: 'home-mobile-dark-zhCN.png',
      locale: 'zhCN' as const,
      theme: 'dark' as const,
      viewport: { width: 390, height: 844 },
    },
    {
      route: '/pricing',
      name: 'pricing-desktop-light-en.png',
      locale: 'en' as const,
      theme: 'light' as const,
      viewport: { width: 1440, height: 900 },
    },
    {
      route: '/sign-in',
      name: 'sign-in-tablet-light-zhCN.png',
      locale: 'zhCN' as const,
      theme: 'light' as const,
      viewport: { width: 768, height: 1024 },
    },
    {
      route: '/404',
      name: '404-mobile-dark-en.png',
      locale: 'en' as const,
      theme: 'dark' as const,
      viewport: { width: 390, height: 844 },
    },
  ]) {
    const page = await newAppPage(browser, item)
    await page.goto(`${APP_ORIGIN}${item.route}`)
    await page.waitForLoadState('networkidle')
    await assertLocaleApplied(page, item.locale)
    await assertThemeApplied(page, item.theme)
    expect(await hasHorizontalOverflow(page)).toBe(false)
    await page.screenshot({
      path: path.join(ARTIFACTS, item.name),
      fullPage: true,
    })
    await page.context().close()
  }
})
