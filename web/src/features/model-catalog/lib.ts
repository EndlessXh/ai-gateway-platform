/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { PlatformModel } from './types'

export type PlatformModelFilters = {
  search: string
  category: string
  capability: string
  availability: string
  /** Distinct upstream `provider_key`. `all` disables the facet. */
  vendor: string
  /**
   * Derived from `pricing.quota_type`: 0 is metered per token, 1 is charged
   * per request. `unpriced` covers models with no pricing configured, which is
   * a real state in the catalogue and must stay visible rather than hidden.
   */
  pricingType: string
}

export const defaultPlatformModelFilters: PlatformModelFilters = {
  search: '',
  category: 'all',
  capability: 'all',
  availability: 'all',
  vendor: 'all',
  pricingType: 'all',
}

export function pricingTypeOf(model: PlatformModel): string {
  if (!model.pricing) return 'unpriced'
  return model.pricing.quota_type === 1 ? 'per_request' : 'per_token'
}

export function filterPlatformModels(
  models: PlatformModel[],
  filters: PlatformModelFilters
): PlatformModel[] {
  const query = filters.search.trim().toLowerCase()
  return models.filter((model) => {
    const matchesSearch =
      !query ||
      `${model.public_model_id} ${model.display_name} ${model.provider_key} ${model.provider_label} ${model.description}`
        .toLowerCase()
        .includes(query)
    return (
      matchesSearch &&
      (filters.category === 'all' || model.category === filters.category) &&
      (filters.capability === 'all' ||
        model.capabilities.includes(filters.capability)) &&
      (filters.availability === 'all' ||
        model.availability_status === filters.availability) &&
      (filters.vendor === 'all' || model.provider_key === filters.vendor) &&
      (filters.pricingType === 'all' ||
        pricingTypeOf(model) === filters.pricingType)
    )
  })
}

/**
 * Uses the upstream-supplied label for a canonical provider key. A provider
 * can have inconsistent source casing, so choose the most common label and
 * resolve ties deterministically instead of inventing a display name.
 */
export function vendorLabelsByKey(
  models: PlatformModel[]
): Record<string, string> {
  const labelCounts = new Map<string, Map<string, number>>()

  for (const model of models) {
    if (!model.provider_key || !model.provider_label) continue
    const labels = labelCounts.get(model.provider_key) ?? new Map()
    labels.set(
      model.provider_label,
      (labels.get(model.provider_label) ?? 0) + 1
    )
    labelCounts.set(model.provider_key, labels)
  }

  const result: Record<string, string> = {}
  for (const [providerKey, labels] of labelCounts) {
    const [label] = [...labels.entries()].sort(
      ([leftLabel, leftCount], [rightLabel, rightCount]) =>
        rightCount - leftCount || leftLabel.localeCompare(rightLabel)
    )[0]
    result[providerKey] = label
  }
  return result
}

/** Returns null for unknown context windows; zero must never render as 0 tokens. */
export function formatContextTokens(contextTokens: number): string | null {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return null
  if (contextTokens % 1_000_000 === 0) return `${contextTokens / 1_000_000}M`
  if (contextTokens % 1_000 === 0) return `${contextTokens / 1_000}K`
  return contextTokens.toLocaleString()
}

export type Facet = { value: string; count: number }

/**
 * Counts each facet value against the models that pass *every other* filter.
 *
 * Counting against the already-filtered list would make every non-selected
 * option read 0 as soon as one filter is applied, which is the classic
 * faceted-search bug. Counting against the unfiltered list instead overstates
 * what a click will actually return. Excluding only the facet's own dimension
 * gives the number the user is really asking for: "how many will I get if I
 * pick this too".
 */
export function facetCounts(
  models: PlatformModel[],
  filters: PlatformModelFilters,
  dimension: keyof PlatformModelFilters,
  valueOf: (model: PlatformModel) => string | string[]
): Facet[] {
  const scoped = filterPlatformModels(models, {
    ...filters,
    [dimension]: 'all',
  })

  const counts = new Map<string, number>()
  for (const model of scoped) {
    const raw = valueOf(model)
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      if (!value) continue
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
