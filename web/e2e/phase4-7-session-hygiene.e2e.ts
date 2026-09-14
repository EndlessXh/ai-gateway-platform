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
import { execFileSync, spawnSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import {
  APP_ORIGIN,
  E2E_RUN_ID,
  cleanupStaleDevSessions,
  cleanupTestSession,
  devSessionCounts,
  devSessionExists,
  firstNonTestDevSessionSID,
  newAppPage,
  resetDevRateLimits,
  signInAsRoot,
  withRootSession,
} from './helpers/app-state'

test.describe('live E2E Session hygiene', () => {
  test.skip(
    !process.env.HYC_LIVE_PASSWORD,
    'Set HYC_LIVE_PASSWORD to verify Session cleanup.'
  )

  test.beforeEach(() => {
    resetDevRateLimits()
    cleanupStaleDevSessions()
  })

  test('successful work restores the exact Session baseline', async ({
    browser,
  }) => {
    const agent = `HYC-E2E/${E2E_RUN_ID}/hygiene-success`
    const before = devSessionCounts(agent)
    const page = await newAppPage(browser, {
      locale: 'en',
      sessionTag: 'hygiene-success',
    })
    await withRootSession(
      page,
      process.env.HYC_LIVE_PASSWORD ?? '',
      async () => {
        const during = devSessionCounts(agent)
        expect(during.total).toBe(before.total + 1)
        expect(during.active).toBe(before.active + 1)
        expect(during.e2e).toBe(before.e2e + 1)
      }
    )
    expect(devSessionCounts(agent)).toEqual(before)
    await page.context().close()
  })

  test('finally cleanup runs after an intentional test-body failure', async ({
    browser,
  }) => {
    const agent = `HYC-E2E/${E2E_RUN_ID}/hygiene-failure`
    const before = devSessionCounts(agent)
    const page = await newAppPage(browser, {
      locale: 'en',
      sessionTag: 'hygiene-failure',
    })
    await expect(
      withRootSession(page, process.env.HYC_LIVE_PASSWORD ?? '', async () => {
        throw new Error('intentional Phase 4.7 fixture failure')
      })
    ).rejects.toThrow('intentional Phase 4.7 fixture failure')
    expect(devSessionCounts(agent)).toEqual(before)
    await page.context().close()
  })

  test('cleaning one exact SID leaves a parallel test Session usable', async ({
    browser,
  }) => {
    const agent = `HYC-E2E/${E2E_RUN_ID}/hygiene-parallel`
    const before = devSessionCounts(agent)
    const first = await newAppPage(browser, {
      locale: 'en',
      sessionTag: 'hygiene-parallel',
    })
    const second = await newAppPage(browser, {
      locale: 'en',
      sessionTag: 'hygiene-parallel',
    })
    const firstSession = await signInAsRoot(
      first,
      process.env.HYC_LIVE_PASSWORD ?? ''
    )
    const secondSession = await signInAsRoot(
      second,
      process.env.HYC_LIVE_PASSWORD ?? ''
    )
    try {
      expect(devSessionCounts(agent).e2e).toBe(before.e2e + 2)
      await cleanupTestSession(first, firstSession.sid)
      expect(devSessionCounts(agent).e2e).toBe(before.e2e + 1)

      await second.goto(`${APP_ORIGIN}/keys`)
      await second.waitForLoadState('networkidle')
      await expect(second.locator('input[name="username"]')).toHaveCount(0)
    } finally {
      await cleanupTestSession(second, secondSession.sid)
      await first.context().close()
      await second.context().close()
    }
    expect(devSessionCounts(agent)).toEqual(before)
  })

  test('cleanup refuses production and cannot match an ordinary Session', () => {
    const production = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        '../scripts/cleanup-e2e-sessions.ps1',
        '-Environment',
        'prod',
      ],
      { encoding: 'utf8' }
    )
    expect(production.status).not.toBe(0)
    expect(`${production.stdout}${production.stderr}`).toContain(
      'refuses production'
    )

    const sid = firstNonTestDevSessionSID()
    if (!sid) return
    expect(devSessionExists(sid)).toBe(true)
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
    expect(devSessionExists(sid)).toBe(true)
  })
})
