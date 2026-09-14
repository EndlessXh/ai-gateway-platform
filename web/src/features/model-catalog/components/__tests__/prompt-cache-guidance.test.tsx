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
import type React from 'react'

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
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'matchMedia',
  'customElements',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { PromptCacheGuidance } = await import('../prompt-cache-guidance')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Prompt caching (Anthropic)': 'Prompt caching (Anthropic)',
        'Prompt caching': 'Prompt caching',
        'Minimum cacheable prompt': 'Minimum cacheable prompt',
        '{{count}} tokens': '{{count}} tokens',
        Source: 'Source',
        Checked: 'Checked',
        'Anthropic documentation': 'Anthropic documentation',
        Measurement: 'Measurement',
        'A development measurement found cache hits cost about 91.6% less than cache writes.':
          'A development measurement found cache hits cost about 91.6% less than cache writes.',
        'Short conversations usually do not reach this threshold.':
          'Short conversations usually do not reach this threshold.',
        'The threshold for this Anthropic model has not been published or measured.':
          'The threshold for this Anthropic model has not been published or measured.',
        "This page only maintains explicit prompt-cache thresholds for Anthropic models. Other providers may use automatic or different caching mechanisms. Their thresholds and billing rules have not been verified here; consult the provider's official documentation.":
          "This page only maintains explicit prompt-cache thresholds for Anthropic models. Other providers may use automatic or different caching mechanisms. Their thresholds and billing rules have not been verified here; consult the provider's official documentation.",
      },
    },
  },
})

type RenderedGuidance = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderGuidance(
  props: React.ComponentProps<typeof PromptCacheGuidance>
): Promise<RenderedGuidance> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <PromptCacheGuidance {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function unmountGuidance(rendered: RenderedGuidance) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

describe('prompt cache guidance', () => {
  after(() => {
    domWindow.close()
  })

  test('shows documented Anthropic metadata and usage guidance', async () => {
    const rendered = await renderGuidance({
      providerKey: 'anthropic',
      promptCache: {
        minimum_tokens: 512,
        source: 'anthropic-docs',
        checked_at: '2026-09-12',
      },
    })

    const text = rendered.container.textContent ?? ''
    assert.equal(text.includes('512 tokens'), true)
    assert.equal(text.includes('Anthropic documentation'), true)
    assert.equal(text.includes('2026-09-12'), true)
    assert.equal(text.includes('91.6% less'), true)

    await unmountGuidance(rendered)
  })

  test('shows the unpublished state for an Anthropic model without metadata', async () => {
    const rendered = await renderGuidance({ providerKey: 'anthropic' })

    assert.equal(
      rendered.container.textContent?.includes(
        'has not been published or measured'
      ),
      true
    )

    await unmountGuidance(rendered)
  })

  test('does not imply no caching for providers without cataloged metadata', async () => {
    const rendered = await renderGuidance({ providerKey: 'openai' })

    assert.equal(
      rendered.container.textContent?.includes('have not been verified here'),
      true
    )

    await unmountGuidance(rendered)
  })
})
