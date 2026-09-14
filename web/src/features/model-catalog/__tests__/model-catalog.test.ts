/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  defaultPlatformModelFilters,
  facetCounts,
  filterPlatformModels,
  pricingTypeOf,
  vendorLabelsByKey,
} from '../lib'
import type { PlatformModel } from '../types'

function catalogModel(
  id: string,
  overrides: Partial<PlatformModel> = {}
): PlatformModel {
  return {
    public_model_id: id,
    display_name: id.includes('reasoning')
      ? 'Reasoning Preview'
      : 'General Preview',
    provider_key: 'platform',
    provider_label: 'Platform routing',
    description: 'Neutral platform model alias',
    category: id.includes('reasoning') ? 'reasoning' : 'general',
    capabilities: id.includes('reasoning')
      ? ['chat', 'reasoning']
      : ['chat', 'streaming'],
    input_modalities: ['text'],
    output_modalities: ['text'],
    context_label: '',
    context_tokens: 0,
    icon_key: 'platform',
    badge: 'preview',
    availability_status: 'preview',
    recommended: false,
    api_enabled: true,
    pricing: null,
    pricing_status: 'unavailable',
    route_availability: 'available',
    sort_order: 10,
    ...overrides,
  }
}

const models = [
  catalogModel('platform-general-preview', { recommended: true }),
  catalogModel('platform-reasoning-preview', {
    availability_status: 'maintenance',
  }),
]

describe('product model catalog filtering', () => {
  test('searches the complete public ID and display metadata', () => {
    const result = filterPlatformModels(models, {
      ...defaultPlatformModelFilters,
      search: 'reasoning-preview',
    })
    assert.deepEqual(
      result.map((model) => model.public_model_id),
      ['platform-reasoning-preview']
    )
  })

  test('combines category, capability, and availability filters', () => {
    const result = filterPlatformModels(models, {
      ...defaultPlatformModelFilters,
      category: 'reasoning',
      capability: 'reasoning',
      availability: 'maintenance',
    })
    assert.equal(result.length, 1)
    assert.equal(result[0].display_name, 'Reasoning Preview')
  })

  test('returns an empty result when no model matches', () => {
    const result = filterPlatformModels(models, {
      ...defaultPlatformModelFilters,
      search: 'not-present',
    })
    assert.deepEqual(result, [])
  })

  test('classifies pricing type from quota_type and missing pricing', () => {
    // quota_type 1 is charged per request; anything else is metered per token.
    // A model with no pricing row is its own state and must not be folded into
    // "per token", which would imply a rate that does not exist.
    const priced = (quotaType: number) => ({
      status: 'configured' as const,
      quota_type: quotaType,
      model_ratio: 0.2,
      completion_ratio: 2.5,
      model_price: 0,
    })

    assert.equal(
      pricingTypeOf(catalogModel('a', { pricing: priced(0) })),
      'per_token'
    )
    assert.equal(
      pricingTypeOf(catalogModel('b', { pricing: priced(1) })),
      'per_request'
    )
    assert.equal(pricingTypeOf(catalogModel('c')), 'unpriced')
  })

  test('facet counts exclude only their own dimension', () => {
    // With a category already selected, the vendor facet must still report
    // counts scoped by that category. Counting against the fully filtered list
    // would report 0 for every vendor except the one already implied.
    const withCategory = {
      ...defaultPlatformModelFilters,
      category: 'reasoning',
    }
    const vendors = facetCounts(
      models,
      withCategory,
      'vendor',
      (model) => model.provider_key
    )
    const total = vendors.reduce((sum, facet) => sum + facet.count, 0)
    assert.equal(total, 1)

    // The category facet itself ignores the category selection, so both
    // categories remain visible and switchable.
    const categories = facetCounts(
      models,
      withCategory,
      'category',
      (model) => model.category
    )
    assert.equal(categories.length, 2)
  })

  test('filters and facets vendors by canonical provider_key', () => {
    const vendorModels = [
      catalogModel('openai-model', {
        provider_key: 'openai',
        provider_label: 'OpenAI',
      }),
      catalogModel('second-openai-model', {
        provider_key: 'openai',
        provider_label: 'openai',
      }),
      catalogModel('third-openai-model', {
        provider_key: 'openai',
        provider_label: 'OpenAI',
      }),
      catalogModel('anthropic-model', {
        provider_key: 'anthropic',
        provider_label: 'Anthropic',
      }),
    ]
    const filters = {
      ...defaultPlatformModelFilters,
      vendor: 'openai',
    }

    assert.deepEqual(
      filterPlatformModels(vendorModels, filters).map(
        (model) => model.public_model_id
      ),
      ['openai-model', 'second-openai-model', 'third-openai-model']
    )
    assert.deepEqual(
      facetCounts(
        vendorModels,
        filters,
        'vendor',
        (model) => model.provider_key
      ),
      [
        { value: 'openai', count: 3 },
        { value: 'anthropic', count: 1 },
      ]
    )
    assert.deepEqual(vendorLabelsByKey(vendorModels), {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
    })
  })
})
