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
  Round 5 layout regressions (D1–D8).

  These assert ranges and structure, never exact pixel values: the point is
  that a defect class cannot come back, not that the design is frozen. Each
  test names the measurement that failed before the fix.
*/

/** Splits a text node into its rendered lines using per-character rects. */
async function renderedLines(
  page: import('@playwright/test').Page,
  selector: string,
  contains: string
) {
  return page.evaluate(
    ({ selector, contains }) => {
      const el = [...document.querySelectorAll(selector)].find((n) =>
        (n.textContent ?? '').includes(contains)
      )
      const node = el?.firstChild
      if (!node || node.nodeType !== 3) return null
      const text = node as Text
      const range = document.createRange()
      const lines: string[] = []
      let current = ''
      let lastTop: number | null = null
      for (let i = 0; i < text.length; i++) {
        range.setStart(text, i)
        range.setEnd(text, i + 1)
        const top = Math.round(range.getBoundingClientRect().top)
        if (lastTop !== null && top !== lastTop) {
          lines.push(current)
          current = ''
        }
        lastTop = top
        current += text.data[i]
      }
      lines.push(current)
      return lines
    },
    { selector, contains }
  )
}

test('D1: Chinese section headings never break mid-compound at 1920', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    locale: 'zhCN',
    theme: 'light',
    viewport: { width: 1920, height: 1080 },
  })
  await page.goto(`${APP_ORIGIN}/`)
  await page.waitForLoadState('networkidle')

  // Before the fix this rendered as ["两种请求格式，一", "个统一管控的网关"],
  // splitting the compound 一个. Chinese has no inter-word spaces, so without
  // `word-break: keep-all` the break can land between any two glyphs.
  const lines = await renderedLines(page, 'h2', '两种请求格式')
  expect(lines, 'heading text node not found').not.toBeNull()
  for (const line of lines ?? []) {
    if (line === (lines ?? [])[(lines ?? []).length - 1]) continue
    // Any line that is not the last must end at punctuation, never mid-phrase.
    expect(
      line.trim(),
      `heading wrapped mid-compound: ${JSON.stringify(lines)}`
    ).toMatch(/[，、。；：,.;:]$/)
  }

  expect(await hasHorizontalOverflow(page)).toBe(false)
  await page.context().close()
})

test('D7: section rhythm at large widths stays inside the intended band', async ({
  browser,
}) => {
  for (const width of [1440, 1920]) {
    const page = await newAppPage(browser, {
      locale: 'en',
      theme: 'light',
      viewport: { width, height: 900 },
    })
    await page.goto(`${APP_ORIGIN}/`)
    await page.waitForLoadState('networkidle')

    // Was 8vw => 115px a side at 1440 and 120px at 1920, i.e. 230px and 240px
    // of empty space between adjacent sections.
    const padding = await page.evaluate(() => {
      const section = [...document.querySelectorAll('section')].find((s) =>
        s.className.includes('section-block')
      )
      return section
        ? Number.parseFloat(getComputedStyle(section).paddingTop)
        : null
    })
    expect(padding, `no section-block found at ${width}`).not.toBeNull()
    const gap = (padding ?? 0) * 2
    expect(gap, `section gap at ${width} is ${gap}px`).toBeGreaterThanOrEqual(
      120
    )
    expect(gap, `section gap at ${width} is ${gap}px`).toBeLessThanOrEqual(176)
    await page.context().close()
  }
})

test('D2: two results never render into a three-column grid', async ({
  browser,
}) => {
  for (const route of ['/pricing', '/model-catalog']) {
    const page = await newAppPage(browser, {
      locale: 'en',
      theme: 'light',
      viewport: { width: 1920, height: 1080 },
    })
    await page.goto(`${APP_ORIGIN}${route}`)
    await page.waitForLoadState('networkidle')

    // Pricing previously resolved to "416px 416px 416px" with two cards, so a
    // third of the row was blank. Assert columns match the card count instead
    // of asserting a width.
    const grid = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('*')].filter(
        (el) =>
          el.children.length === 0 &&
          /platform-(general|reasoning)-preview/.test(el.textContent ?? '')
      )
      if (!anchors.length) return null
      let node: Element | null = anchors[0]
      while (node?.parentElement) {
        if (anchors.every((a) => node?.parentElement?.contains(a))) break
        node = node.parentElement
      }
      const container = node?.parentElement
      if (!container) return null
      const columns = getComputedStyle(container)
        .gridTemplateColumns.split(' ')
        .filter(Boolean).length
      return { columns, cards: container.children.length }
    })

    expect(grid, `no result grid on ${route}`).not.toBeNull()
    expect(
      grid?.columns,
      `${route} renders ${grid?.cards} cards in ${grid?.columns} columns`
    ).toBeLessThanOrEqual(grid?.cards ?? 0)
    await page.context().close()
  }
})

test('D3: tablet auth fills its column instead of floating a lone card', async ({
  browser,
}) => {
  for (const route of ['/sign-in', '/sign-up']) {
    const page = await newAppPage(browser, {
      locale: 'en',
      theme: 'light',
      viewport: { width: 768, height: 1024 },
    })
    await page.goto(`${APP_ORIGIN}${route}`)
    await page.waitForLoadState('networkidle')

    // The narrative was `lg:flex`, so at 768 it vanished and the form card sat
    // in the middle of an empty column: 36% fill, 309px dead space each side.
    const fill = await page.evaluate(() => {
      const main = document.querySelector('main')
      const aside = document.querySelector('aside')
      const card = document
        .querySelector('form')
        ?.closest('div[class*="rounded"]')
      if (!main || !card) return null
      const asideVisible =
        aside && getComputedStyle(aside).display !== 'none' ? aside : null
      const content =
        (asideVisible?.getBoundingClientRect().height ?? 0) +
        card.getBoundingClientRect().height
      return Math.round((content / main.getBoundingClientRect().height) * 100)
    })

    expect(fill, `no auth layout found on ${route}`).not.toBeNull()
    expect(
      fill,
      `${route} fills only ${fill}% of its column at 768`
    ).toBeGreaterThan(60)
    expect(await hasHorizontalOverflow(page)).toBe(false)
    await page.context().close()
  }
})

test('D3: phone auth still puts the form first', async ({ browser }) => {
  const page = await newAppPage(browser, {
    locale: 'en',
    theme: 'light',
    viewport: { width: 390, height: 844 },
  })
  await page.goto(`${APP_ORIGIN}/sign-in`)
  await page.waitForLoadState('networkidle')

  // The tablet band must not push the form below a screenful of narrative.
  const asideVisible = await page.evaluate(() => {
    const aside = document.querySelector('aside')
    return aside ? getComputedStyle(aside).display !== 'none' : false
  })
  expect(asideVisible, 'narrative band should be hidden on phones').toBe(false)
  expect(await hasHorizontalOverflow(page)).toBe(false)
  await page.context().close()
})

test('D4: leaderboard masthead uses the shared page-title scale', async ({
  browser,
}) => {
  const page = await newAppPage(browser, {
    locale: 'en',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
  })
  await page.goto(`${APP_ORIGIN}/leaderboard`)
  await page.waitForLoadState('networkidle')

  // Was a one-off clamp(1.75rem,4vw,2.5rem), visibly smaller than every other
  // page title. Compared against the catalogue rather than a literal px value.
  const leaderboardSize = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.querySelector('h1') as Element).fontSize
    )
  )
  await page.goto(`${APP_ORIGIN}/model-catalog`)
  await page.waitForLoadState('networkidle')
  const catalogSize = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.querySelector('h1') as Element).fontSize
    )
  )

  expect(leaderboardSize).toBeCloseTo(catalogSize, 0)
  await page.context().close()
})
