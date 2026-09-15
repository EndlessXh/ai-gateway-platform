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
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { GrowthText } = await import('../growth-text')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

async function renderGrowth(value: number) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<GrowthText value={value} />)
  })
  const span = container.querySelector('span')
  const result = {
    text: span?.textContent ?? '',
    className: span?.className ?? '',
  }
  await act(async () => root.unmount())
  container.remove()
  return result
}

describe('rankings growth text', () => {
  after(() => {
    domWindow.close()
  })

  test('renders an up arrow and emerald color for positive growth', async () => {
    const result = await renderGrowth(41.2)
    assert.equal(result.text, '↑41.2%')
    assert.match(result.className, /text-emerald-600/)
    assert.doesNotMatch(result.className, /text-rose-600/)
  })

  test('renders a down arrow and rose color for negative growth', async () => {
    const result = await renderGrowth(-9.4)
    assert.equal(result.text, '↓9.4%')
    assert.match(result.className, /text-rose-600/)
    assert.doesNotMatch(result.className, /text-emerald-600/)
  })

  test('renders a neutral 0% with no arrow when growth is zero', async () => {
    const result = await renderGrowth(0)
    assert.equal(result.text, '0%')
    assert.doesNotMatch(result.className, /text-emerald-600|text-rose-600/)
  })

  test('rounds large magnitude growth to a whole percent', async () => {
    const result = await renderGrowth(4085)
    assert.equal(result.text, '↑4085%')
  })
})
