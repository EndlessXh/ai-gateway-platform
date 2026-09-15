/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { Facet } from '../lib'

type FacetGroupProps = {
  title: string
  allLabel: string
  value: string
  facets: Facet[]
  total: number
  onChange: (next: string) => void
  /** Maps a raw facet value to a display label (status keys, pricing types). */
  labelFor?: (value: string) => string
}

/**
 * One filter dimension rendered as selectable chips with counts.
 *
 * Chips rather than checkboxes: each dimension here is single-select, and a
 * chip row stays readable at the sidebar's width where a checkbox column of
 * long provider names would wrap badly.
 */
function FacetGroup(props: FacetGroupProps) {
  const { t } = useTranslation()
  const label = (value: string) =>
    props.labelFor ? props.labelFor(value) : value

  if (props.facets.length === 0) return null

  return (
    <section className='border-border/60 border-b py-4 first:pt-0 last:border-b-0'>
      <h3 className='text-foreground mb-3 text-sm font-semibold'>
        {props.title}
      </h3>
      <div className='flex flex-wrap gap-1.5'>
        <button
          type='button'
          onClick={() => props.onChange('all')}
          aria-pressed={props.value === 'all'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
            props.value === 'all'
              ? 'border-primary/40 bg-primary/10 text-foreground font-medium'
              : 'border-border/70 text-muted-foreground hover:text-foreground hover:border-border'
          )}
        >
          {props.allLabel}
          <span className='data-value text-muted-foreground/70 text-[10px]'>
            {props.total}
          </span>
        </button>
        {props.facets.map((facet) => (
          <button
            key={facet.value}
            type='button'
            onClick={() =>
              props.onChange(props.value === facet.value ? 'all' : facet.value)
            }
            aria-pressed={props.value === facet.value}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
              props.value === facet.value
                ? 'border-primary/40 bg-primary/10 text-foreground font-medium'
                : 'border-border/70 text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            <span className='max-w-[10rem] truncate'>{label(facet.value)}</span>
            <span className='data-value text-muted-foreground/70 text-[10px]'>
              {facet.count}
            </span>
          </button>
        ))}
      </div>
      <span className='sr-only'>{t('Filter')}</span>
    </section>
  )
}

export type ModelFiltersSidebarProps = {
  className?: string
  total: number
  categories: Facet[]
  vendors: Facet[]
  vendorLabels: Record<string, string>
  capabilities: Facet[]
  pricingTypes: Facet[]
  availabilities: Facet[]
  category: string
  vendor: string
  capability: string
  pricingType: string
  availability: string
  onCategoryChange: (next: string) => void
  onVendorChange: (next: string) => void
  onCapabilityChange: (next: string) => void
  onPricingTypeChange: (next: string) => void
  onAvailabilityChange: (next: string) => void
  onReset: () => void
  hasActiveFilters: boolean
}

export function ModelFiltersSidebar(props: ModelFiltersSidebarProps) {
  const { t } = useTranslation()

  const pricingLabel = (value: string) => {
    if (value === 'per_token') return t('Metered per token')
    if (value === 'per_request') return t('Per request')
    return t('No price configured')
  }

  const availabilityLabel = (value: string) => {
    const labels: Record<string, string> = {
      available: t('Available'),
      preview: t('Preview'),
      maintenance: t('Maintenance'),
      coming_soon: t('Coming soon'),
      disabled: t('Disabled'),
    }
    return labels[value] ?? value
  }

  /*
    Category, capability and provider facets are closed enum keys defined by
    the backend (`platformCapabilityKeys` in model/platform_model_catalog.go)
    and every one of them already has an en/zh entry. Without this they render
    the raw identifier — "general", "streaming", "json_mode" — in both
    languages. i18next returns the key unchanged when a translation is
    missing, so a newly added enum value degrades to its identifier rather
    than to an empty label.
  */
  const enumLabel = (value: string) => t(value)

  /*
    Vendor facets carry the canonical `provider_key`; their labels come from
    the upstream-supplied `provider_label` chosen by the parent. Unknown keys
    fall through to their raw value rather than inventing a vendor name.
  */
  const vendorLabel = (value: string) => props.vendorLabels[value] ?? value

  return (
    <aside
      className={cn('lg:sticky lg:top-24 lg:self-start', props.className)}
      aria-label={t('Model filters')}
    >
      <div className='border-border/60 bg-card/50 rounded-xl border p-4 backdrop-blur'>
        <div className='mb-3 flex items-start justify-between gap-3'>
          <div>
            <h2 className='text-sm font-semibold'>{t('Filter')}</h2>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t('Refine by provider, category, capability and pricing.')}
            </p>
          </div>
          {props.hasActiveFilters ? (
            <button
              type='button'
              onClick={props.onReset}
              className='text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs transition-colors'
            >
              <RotateCcw className='size-3' />
              {t('Reset')}
            </button>
          ) : null}
        </div>

        <FacetGroup
          title={t('Category')}
          allLabel={t('All categories')}
          value={props.category}
          facets={props.categories}
          total={props.total}
          onChange={props.onCategoryChange}
          labelFor={enumLabel}
        />
        <FacetGroup
          title={t('Vendor')}
          allLabel={t('All Vendors')}
          value={props.vendor}
          facets={props.vendors}
          total={props.total}
          onChange={props.onVendorChange}
          labelFor={vendorLabel}
        />
        <FacetGroup
          title={t('Capability')}
          allLabel={t('All capabilities')}
          value={props.capability}
          facets={props.capabilities}
          total={props.total}
          onChange={props.onCapabilityChange}
          labelFor={enumLabel}
        />
        <FacetGroup
          title={t('Pricing type')}
          allLabel={t('All pricing')}
          value={props.pricingType}
          facets={props.pricingTypes}
          total={props.total}
          onChange={props.onPricingTypeChange}
          labelFor={pricingLabel}
        />
        <FacetGroup
          title={t('Status')}
          allLabel={t('All statuses')}
          value={props.availability}
          facets={props.availabilities}
          total={props.total}
          onChange={props.onAvailabilityChange}
          labelFor={availabilityLabel}
        />
      </div>
    </aside>
  )
}
