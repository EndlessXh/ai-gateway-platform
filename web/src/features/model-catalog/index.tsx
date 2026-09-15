/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid2X2,
  List,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import { ModelCatalogCard } from './components/model-catalog-card'
import { ModelCatalogDetailsDrawer } from './components/model-catalog-details-drawer'
import { ModelFiltersSidebar } from './components/model-filters-sidebar'
import { usePlatformModels } from './hooks'
import {
  defaultPlatformModelFilters,
  facetCounts,
  filterPlatformModels,
  pricingTypeOf,
  vendorLabelsByKey,
  type PlatformModelFilters,
} from './lib'
import type { PlatformModel } from './types'

const loadingCardKeys = [
  'catalog-loading-1',
  'catalog-loading-2',
  'catalog-loading-3',
  'catalog-loading-4',
  'catalog-loading-5',
  'catalog-loading-6',
]

const PAGE_SIZE = 12

type SortKey = 'name' | 'price'
type ViewMode = 'grid' | 'list'

export function ModelCatalog() {
  const { t } = useTranslation()
  const { data = [], isLoading, error, refetch } = usePlatformModels()
  const { status } = useStatus()
  const [filters, setFilters] = useState<PlatformModelFilters>(
    defaultPlatformModelFilters
  )
  const [sort, setSort] = useState<SortKey>('name')
  const [page, setPage] = useState(1)
  const [tokenUnit, setTokenUnit] = useState<'M' | 'K'>('M')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<PlatformModel | null>(null)
  const priceRate = Math.max((status?.price as number) ?? 1, 0.001)
  const usdExchangeRate = Math.max(
    (status?.usd_exchange_rate as number) ?? priceRate,
    0.001
  )

  const setFilter = <K extends keyof PlatformModelFilters>(
    key: K,
    value: PlatformModelFilters[K]
  ) => setFilters((current) => ({ ...current, [key]: value }))

  const filtered = useMemo(
    () => filterPlatformModels(data, filters),
    [data, filters]
  )

  const sorted = useMemo(() => {
    const rows = [...filtered]
    if (sort === 'price') {
      // Models without pricing sort last rather than being treated as free.
      rows.sort((a, b) => {
        const priceOf = (value: (typeof rows)[number]) =>
          value.pricing ? value.pricing.model_ratio : Number.POSITIVE_INFINITY
        return priceOf(a) - priceOf(b)
      })
      return rows
    }
    rows.sort((a, b) => a.public_model_id.localeCompare(b.public_model_id))
    return rows
  }, [filtered, sort])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // A filter change can shrink the result set below the current page.
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  const facets = useMemo(
    () => ({
      categories: facetCounts(data, filters, 'category', (m) => m.category),
      vendors: facetCounts(data, filters, 'vendor', (m) => m.provider_key),
      capabilities: facetCounts(
        data,
        filters,
        'capability',
        (m) => m.capabilities
      ),
      pricingTypes: facetCounts(data, filters, 'pricingType', pricingTypeOf),
      availabilities: facetCounts(
        data,
        filters,
        'availability',
        (m) => m.availability_status
      ),
    }),
    [data, filters]
  )

  const vendorLabels = useMemo(() => vendorLabelsByKey(data), [data])

  const hasActiveFilters =
    filters.category !== 'all' ||
    filters.vendor !== 'all' ||
    filters.capability !== 'all' ||
    filters.pricingType !== 'all' ||
    filters.availability !== 'all'

  if (error) {
    return (
      <PublicLayout showMainContainer={false}>
        <div className='page-container pt-24 pb-16'>
          <ErrorState
            title={t('Model catalog could not be loaded')}
            description={t(
              'The gateway model catalog is temporarily unavailable.'
            )}
            onRetry={() => void refetch()}
          />
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='page-container pt-21 pb-12 sm:pt-30 sm:pb-16'>
        {/* Centred masthead + search, matching the reference catalogue entry. */}
        <header className='mx-auto max-w-3xl text-center'>
          <h1 className='type-page-title type-page-title-lg'>
            {t('Model Square')}
          </h1>
          <p className='text-muted-foreground mx-auto mt-4 max-w-2xl text-sm leading-6 sm:text-base'>
            {t('This site currently has {{count}} models enabled', {
              count: data.length,
            })}
          </p>
          <p className='text-muted-foreground mx-auto mt-2 max-w-2xl text-sm leading-6'>
            {t(
              'Choose stable platform aliases with live route and pricing metadata. Underlying providers can change without changing your API request.'
            )}
          </p>

          <div className='relative mx-auto mt-8 max-w-2xl'>
            <Search className='text-muted-foreground/70 pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2' />
            <Input
              value={filters.search}
              onChange={(event) => {
                setFilter('search', event.target.value)
                setPage(1)
              }}
              placeholder={t('Search model name, provider, or capability...')}
              aria-label={t('Search models')}
              className='h-11 ps-9'
            />
          </div>
        </header>

        <div className='mt-10 grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]'>
          <div className='hidden xl:block'>
            <ModelFiltersSidebar
              total={data.length}
              categories={facets.categories}
              vendors={facets.vendors}
              vendorLabels={vendorLabels}
              capabilities={facets.capabilities}
              pricingTypes={facets.pricingTypes}
              availabilities={facets.availabilities}
              category={filters.category}
              vendor={filters.vendor}
              capability={filters.capability}
              pricingType={filters.pricingType}
              availability={filters.availability}
              onCategoryChange={(v) => {
                setFilter('category', v)
                setPage(1)
              }}
              onVendorChange={(v) => {
                setFilter('vendor', v)
                setPage(1)
              }}
              onCapabilityChange={(v) => {
                setFilter('capability', v)
                setPage(1)
              }}
              onPricingTypeChange={(v) => {
                setFilter('pricingType', v)
                setPage(1)
              }}
              onAvailabilityChange={(v) => {
                setFilter('availability', v)
                setPage(1)
              }}
              onReset={() => {
                setFilters({
                  ...defaultPlatformModelFilters,
                  search: filters.search,
                })
                setPage(1)
              }}
              hasActiveFilters={hasActiveFilters}
            />
          </div>

          <div className='min-w-0'>
            <div className='border-border/60 bg-card/50 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 backdrop-blur'>
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setMobileFiltersOpen(true)}
                  className='gap-1.5 xl:hidden'
                >
                  <Filter className='size-4' />
                  {t('Filter')}
                </Button>
                <p className='text-sm'>
                  <span className='data-value font-semibold'>
                    {sorted.length}
                  </span>{' '}
                  <span className='text-muted-foreground'>{t('models')}</span>
                </p>
              </div>
              <div className='flex flex-wrap items-center justify-end gap-2'>
                <div
                  className='bg-muted/60 inline-flex h-8 items-center rounded-lg border p-0.5'
                  role='group'
                  aria-label={t('Token unit')}
                >
                  {(['M', 'K'] as const).map((unit) => (
                    <button
                      key={unit}
                      type='button'
                      onClick={() => setTokenUnit(unit)}
                      aria-pressed={tokenUnit === unit}
                      className={cn(
                        'h-full rounded-md px-2.5 text-xs font-medium transition-colors',
                        tokenUnit === unit
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      /1{unit}
                    </button>
                  ))}
                </div>
                <div
                  className='bg-muted/60 inline-flex h-8 items-center rounded-lg border p-0.5'
                  role='group'
                  aria-label={t('Sort models')}
                >
                  {(
                    [
                      { key: 'name', label: t('Name') },
                      { key: 'price', label: t('Price') },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.key}
                      type='button'
                      onClick={() => setSort(option.key)}
                      aria-pressed={sort === option.key}
                      className={cn(
                        'h-full rounded-md px-2.5 text-xs font-medium transition-colors',
                        sort === option.key
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <ArrowUpDown className='mr-1 inline size-3' />
                      {option.label}
                    </button>
                  ))}
                </div>
                <div
                  className='bg-muted/60 inline-flex h-8 items-center rounded-lg border p-0.5'
                  role='group'
                  aria-label={t('View mode')}
                >
                  <button
                    type='button'
                    onClick={() => setViewMode('grid')}
                    aria-label={t('Card view')}
                    aria-pressed={viewMode === 'grid'}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md transition-colors',
                      viewMode === 'grid'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Grid2X2 className='size-3.5' />
                  </button>
                  <button
                    type='button'
                    onClick={() => setViewMode('list')}
                    aria-label={t('List view')}
                    aria-pressed={viewMode === 'list'}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md transition-colors',
                      viewMode === 'list'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <List className='size-3.5' />
                  </button>
                </div>
              </div>
            </div>

            {isLoading && (
              <div
                className='grid gap-4 lg:grid-cols-3'
                aria-label={t('Loading models')}
              >
                {loadingCardKeys.map((key) => (
                  <Skeleton key={key} className='h-80 rounded-2xl' />
                ))}
              </div>
            )}

            {!isLoading && sorted.length === 0 && (
              <div className='bg-muted/25 rounded-2xl border border-dashed px-6 py-20 text-center'>
                <h2 className='font-semibold'>
                  {t('No models match these filters')}
                </h2>
                <p className='text-muted-foreground mt-2 text-sm'>
                  {t('Clear or change a filter to see more models.')}
                </p>
                {hasActiveFilters ? (
                  <Button
                    variant='outline'
                    size='sm'
                    className='mt-5'
                    onClick={() => {
                      setFilters(defaultPlatformModelFilters)
                      setPage(1)
                    }}
                  >
                    {t('Reset')}
                  </Button>
                ) : null}
              </div>
            )}

            {!isLoading && sorted.length > 0 && (
              <section
                className={cn(
                  'grid gap-4',
                  viewMode === 'grid' ? 'lg:grid-cols-3' : 'grid-cols-1'
                )}
                aria-label={t('Model catalog results')}
              >
                {visible.map((model) => (
                  <ModelCatalogCard
                    key={model.public_model_id}
                    model={model}
                    tokenUnit={tokenUnit}
                    priceRate={priceRate}
                    usdExchangeRate={usdExchangeRate}
                    listView={viewMode === 'list'}
                    onDetails={() => setSelectedModel(model)}
                  />
                ))}
              </section>
            )}

            {!isLoading && pageCount > 1 && (
              <nav
                className='mt-8 flex items-center justify-between'
                aria-label={t('Pagination')}
              >
                <p className='text-muted-foreground text-sm'>
                  {t('Page {{page}} of {{total}}', {
                    page,
                    total: pageCount,
                  })}
                </p>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className='size-4' />
                    {t('Previous')}
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    {t('Next')}
                    <ChevronRight className='size-4' />
                  </Button>
                </div>
              </nav>
            )}
          </div>
        </div>
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetContent
            side='right'
            className='w-full overflow-y-auto p-4 sm:max-w-md'
          >
            <SheetHeader className='pr-10'>
              <SheetTitle>{t('Filter')}</SheetTitle>
              <SheetDescription>
                {t('Refine by provider, category, capability and pricing.')}
              </SheetDescription>
            </SheetHeader>
            <ModelFiltersSidebar
              className='mt-4'
              total={data.length}
              categories={facets.categories}
              vendors={facets.vendors}
              vendorLabels={vendorLabels}
              capabilities={facets.capabilities}
              pricingTypes={facets.pricingTypes}
              availabilities={facets.availabilities}
              category={filters.category}
              vendor={filters.vendor}
              capability={filters.capability}
              pricingType={filters.pricingType}
              availability={filters.availability}
              onCategoryChange={(v) => {
                setFilter('category', v)
                setPage(1)
              }}
              onVendorChange={(v) => {
                setFilter('vendor', v)
                setPage(1)
              }}
              onCapabilityChange={(v) => {
                setFilter('capability', v)
                setPage(1)
              }}
              onPricingTypeChange={(v) => {
                setFilter('pricingType', v)
                setPage(1)
              }}
              onAvailabilityChange={(v) => {
                setFilter('availability', v)
                setPage(1)
              }}
              onReset={() => {
                setFilters({
                  ...defaultPlatformModelFilters,
                  search: filters.search,
                })
                setPage(1)
              }}
              hasActiveFilters={hasActiveFilters}
            />
          </SheetContent>
        </Sheet>
        <ModelCatalogDetailsDrawer
          model={selectedModel}
          onOpenChange={(open) => {
            if (!open) setSelectedModel(null)
          }}
          tokenUnit={tokenUnit}
          priceRate={priceRate}
          usdExchangeRate={usdExchangeRate}
        />
      </PageTransition>
    </PublicLayout>
  )
}
