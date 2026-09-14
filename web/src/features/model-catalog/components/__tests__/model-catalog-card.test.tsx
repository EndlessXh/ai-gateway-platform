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

import type { PlatformModel } from '../../types'

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

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Input: 'Input',
        Output: 'Output',
        Cached: 'Cached',
        Details: 'Details',
        'Metered per token': 'Metered per token',
        'Per request': 'Per request',
        request: 'request',
        'Pricing unavailable': 'Pricing unavailable',
        'No description available.': 'No description available.',
        'Copy full model ID': 'Copy full model ID',
        'Copy full model ID: {{modelId}}': 'Copy full model ID: {{modelId}}',
        'Model ID copied': 'Model ID copied',
      },
    },
  },
})

const { ModelCatalogCard } = await import('../model-catalog-card')
const { formatPrice, formatRequestPrice } =
  await import('@/features/pricing/lib/price')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function catalogModel(
  id: string,
  overrides: Partial<PlatformModel> = {}
): PlatformModel {
  return {
    public_model_id: id,
    display_name: id,
    provider_key: 'openai',
    provider_label: 'Northstar Labs',
    description: 'Neutral capability profile for catalogue verification.',
    category: 'general',
    capabilities: ['chat'],
    input_modalities: ['text'],
    output_modalities: ['text'],
    context_label: '32K',
    context_tokens: 32_000,
    icon_key: 'sparkles',
    badge: '',
    availability_status: 'available',
    recommended: false,
    api_enabled: true,
    pricing: {
      status: 'configured',
      quota_type: 0,
      model_ratio: 0.5,
      completion_ratio: 2,
      model_price: 0,
      cache_ratio: 0.1,
    },
    pricing_status: 'configured',
    route_availability: 'available',
    sort_order: 1,
    ...overrides,
  }
}

function expectedTieredPrice(
  model: PlatformModel,
  type: 'input' | 'output' | 'cache'
) {
  if (!model.pricing) return ''
  return formatPrice(
    {
      id: 0,
      model_name: model.public_model_id,
      quota_type: model.pricing.quota_type,
      model_ratio: model.pricing.model_ratio,
      completion_ratio: model.pricing.completion_ratio,
      model_price: model.pricing.model_price,
      cache_ratio: model.pricing.cache_ratio,
      enable_groups: [],
    },
    type,
    'M',
    false,
    1,
    1
  )
}

function expectedRequestPrice(model: PlatformModel) {
  if (!model.pricing) return ''
  return formatRequestPrice(
    {
      id: 0,
      model_name: model.public_model_id,
      quota_type: model.pricing.quota_type,
      model_ratio: model.pricing.model_ratio,
      completion_ratio: model.pricing.completion_ratio,
      model_price: model.pricing.model_price,
      enable_groups: [],
    },
    false,
    1,
    1
  )
}

type RenderedCard = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderCard(
  props: React.ComponentProps<typeof ModelCatalogCard>
): Promise<RenderedCard> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <ModelCatalogCard {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function unmountCard(rendered: RenderedCard) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

function normalizedText(value: string | null): string {
  return (value ?? '').replaceAll(/\s/g, '')
}

describe('model catalog card', () => {
  after(() => {
    domWindow.close()
  })

  test('shows separate input, output, and cached prices for a token-based model', async () => {
    const model = catalogModel('platform-general-01')
    const rendered = await renderCard({
      model,
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })

    const text = normalizedText(rendered.container.textContent)
    assert.equal(
      text.includes(`Input${expectedTieredPrice(model, 'input')}/1M`),
      true
    )
    assert.equal(
      text.includes(`Output${expectedTieredPrice(model, 'output')}/1M`),
      true
    )
    assert.equal(
      text.includes(`Cached${expectedTieredPrice(model, 'cache')}`),
      true
    )
    assert.equal(text.includes('Meteredpertoken'), true)

    await unmountCard(rendered)
  })

  test('omits the cached price row when the model has no cache ratio', async () => {
    const model = catalogModel('platform-general-02', {
      pricing: {
        status: 'configured',
        quota_type: 0,
        model_ratio: 0.5,
        completion_ratio: 2,
        model_price: 0,
      },
    })
    const rendered = await renderCard({
      model,
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })

    assert.equal(rendered.container.textContent?.includes('Cached'), false)

    await unmountCard(rendered)
  })

  test('shows a single request price with no input/output split for per-request billing', async () => {
    const model = catalogModel('platform-image-01', {
      category: 'image',
      pricing: {
        status: 'configured',
        quota_type: 1,
        model_ratio: 0,
        completion_ratio: 1,
        model_price: 2.5,
      },
    })
    const rendered = await renderCard({
      model,
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })

    const text = normalizedText(rendered.container.textContent)
    assert.equal(text.includes(`${expectedRequestPrice(model)}/request`), true)
    assert.equal(text.includes('Input'), false)
    assert.equal(text.includes('Output'), false)
    assert.equal(text.includes('Perrequest'), true)

    await unmountCard(rendered)
  })

  test('falls back to a placeholder when the description is empty', async () => {
    const model = catalogModel('platform-general-03', { description: '' })
    const rendered = await renderCard({
      model,
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })

    assert.equal(
      rendered.container.textContent?.includes('No description available.'),
      true
    )

    await unmountCard(rendered)
  })

  test('selects the vendor icon from provider_key', async () => {
    const rendered = await renderCard({
      model: catalogModel('platform-general-07'),
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })

    const vendorIcon = rendered.container.querySelector(
      '[role="img"][aria-label="Northstar Labs"]'
    )
    assert.ok(vendorIcon)
    assert.equal(vendorIcon.querySelector('title')?.textContent, 'OpenAI')
    await unmountCard(rendered)
  })

  test('keeps a common-length model ID in the card name region', async () => {
    const modelID = 'deepseek-r1-distill-llama-70b'
    const rendered = await renderCard({
      model: catalogModel(modelID, { display_name: 'DeepSeek R1 Distill' }),
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })

    const name = rendered.container.querySelector(
      '[data-testid="model-catalog-name"]'
    )
    assert.equal(name?.textContent, modelID)
    assert.equal(name?.getAttribute('title'), modelID)
    await unmountCard(rendered)
  })

  test('shows the context window and treats zero as unknown', async () => {
    const known = await renderCard({
      model: catalogModel('platform-general-05', { context_tokens: 128_000 }),
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })
    assert.equal(
      normalizedText(known.container.textContent).includes('Context128K'),
      true
    )
    await unmountCard(known)

    const unknown = await renderCard({
      model: catalogModel('platform-general-06', { context_tokens: 0 }),
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {},
    })
    assert.equal(
      normalizedText(unknown.container.textContent).includes('ContextUnknown'),
      true
    )
    assert.equal(
      normalizedText(unknown.container.textContent).includes('Context0'),
      false
    )
    await unmountCard(unknown)
  })

  test('invokes onDetails when the details button is activated', async () => {
    const model = catalogModel('platform-general-04')
    let clicks = 0
    const rendered = await renderCard({
      model,
      tokenUnit: 'M',
      priceRate: 1,
      usdExchangeRate: 1,
      onDetails: () => {
        clicks += 1
      },
    })

    const detailsButton = [
      ...rendered.container.querySelectorAll('button'),
    ].find((button) => button.textContent?.includes('Details'))
    assert.ok(detailsButton)
    await act(async () => {
      detailsButton?.click()
    })
    assert.equal(clicks, 1)

    await unmountCard(rendered)
  })
})
