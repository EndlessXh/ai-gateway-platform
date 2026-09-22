/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Activity, CheckCircle2, Gauge, Layers, Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import type { PricingModel, TokenUnit } from '@/features/pricing/types'

import type { PlatformModel } from '../types'
import { PromptCacheGuidance } from './prompt-cache-guidance'

function pricingModel(model: PlatformModel): PricingModel | null {
  if (!model.pricing) return null
  return {
    id: 0,
    model_name: model.public_model_id,
    quota_type: model.pricing.quota_type,
    model_ratio: model.pricing.model_ratio,
    completion_ratio: model.pricing.completion_ratio,
    model_price: model.pricing.model_price,
    cache_ratio: model.pricing.cache_ratio,
    create_cache_ratio: model.pricing.create_cache_ratio,
    image_ratio: model.pricing.image_ratio,
    audio_ratio: model.pricing.audio_ratio,
    audio_completion_ratio: model.pricing.audio_completion_ratio,
    enable_groups: [],
  }
}

function CatalogValue(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='bg-card min-w-0 rounded-lg border p-3'>
      <p className='text-muted-foreground text-xs font-medium'>{props.label}</p>
      <div className='mt-1 min-w-0 text-sm font-semibold'>{props.children}</div>
    </div>
  )
}

function ModelOverview(props: {
  model: PlatformModel
  tokenUnit: TokenUnit
  priceRate: number
  usdExchangeRate: number
}) {
  const { t } = useTranslation()
  const priced = pricingModel(props.model)
  const endpoint =
    props.model.category === 'embedding'
      ? '/v1/embeddings'
      : '/v1/chat/completions'
  const unit = props.tokenUnit === 'K' ? 'K' : 'M'
  let primaryPrice = t('Pricing unavailable')
  if (priced?.quota_type === 0) {
    primaryPrice = formatPrice(
      priced,
      'input',
      unit,
      false,
      props.priceRate,
      props.usdExchangeRate
    )
  } else if (priced) {
    primaryPrice = formatRequestPrice(
      priced,
      false,
      props.priceRate,
      props.usdExchangeRate
    )
  }

  return (
    <div className='space-y-5'>
      <section>
        <h2 className='text-sm font-semibold'>{t('Pricing')}</h2>
        <div className='mt-3 grid gap-3 sm:grid-cols-2'>
          <CatalogValue label={t('Model pricing')}>{primaryPrice}</CatalogValue>
          <CatalogValue label={t('Cached input')}>
            {priced?.cache_ratio != null
              ? formatPrice(
                  priced,
                  'cache',
                  unit,
                  false,
                  props.priceRate,
                  props.usdExchangeRate
                )
              : t('Pricing unavailable')}
          </CatalogValue>
          <CatalogValue label={t('Type')}>
            {priced?.quota_type === 1
              ? t('Per request')
              : t('Metered per token')}
          </CatalogValue>
        </div>
        <div className='mt-3'>
          <PromptCacheGuidance
            providerKey={props.model.provider_key}
            promptCache={props.model.prompt_cache}
          />
        </div>
      </section>

      <section>
        <h2 className='text-sm font-semibold'>{t('Model')}</h2>
        <div className='mt-3 grid gap-3 sm:grid-cols-2'>
          <CatalogValue label={t('Provider')}>
            {props.model.provider_label}
          </CatalogValue>
          <CatalogValue label={t('Category')}>
            {t(props.model.category)}
          </CatalogValue>
          <CatalogValue label={t('Context')}>
            {props.model.context_label || '—'}
          </CatalogValue>
          <CatalogValue label={t('Endpoint')}>
            <code className='block truncate font-mono text-xs'>{endpoint}</code>
          </CatalogValue>
          <CatalogValue label={t('Status')}>
            {t(props.model.availability_status)}
          </CatalogValue>
          <CatalogValue label={t('Route')}>
            <span className='inline-flex items-center gap-1'>
              {props.model.route_availability === 'available' ? (
                <CheckCircle2 className='text-success size-3.5' />
              ) : null}
              {t(props.model.route_availability)}
            </span>
          </CatalogValue>
        </div>
      </section>

      <section>
        <h2 className='text-sm font-semibold'>{t('Capabilities')}</h2>
        <div className='mt-3 flex flex-wrap gap-2'>
          {props.model.capabilities.map((capability) => (
            <span
              key={capability}
              className='bg-muted text-muted-foreground rounded-md px-2.5 py-1 text-xs font-medium'
            >
              {t(capability)}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

function ModelPerformance() {
  const { t } = useTranslation()
  return (
    <section className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-3'>
        <CatalogValue label='TPS'>—</CatalogValue>
        <CatalogValue label={t('Average latency')}>—</CatalogValue>
        <CatalogValue label={t('Success rate')}>—</CatalogValue>
      </div>
      <div className='bg-muted/30 rounded-xl border px-4 py-10 text-center'>
        <Activity className='text-muted-foreground mx-auto size-5' />
        <p className='text-muted-foreground mt-3 text-sm'>
          {t('No performance data available')}
        </p>
      </div>
    </section>
  )
}

function ModelApi(props: { model: PlatformModel }) {
  const { t } = useTranslation()
  const endpoint =
    props.model.category === 'embedding'
      ? '/v1/embeddings'
      : '/v1/chat/completions'
  const example = JSON.stringify(
    {
      model: props.model.public_model_id,
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      top_p: 0.9,
    },
    null,
    2
  )

  return (
    <div className='space-y-5'>
      <section>
        <h2 className='text-sm font-semibold'>{t('Code samples')}</h2>
        <div className='bg-muted/45 mt-3 overflow-x-auto rounded-xl border p-4'>
          <pre className='font-mono text-xs leading-5 whitespace-pre-wrap'>
            {`POST ${endpoint}\n\n${example}`}
          </pre>
        </div>
      </section>
      <section className='grid gap-3 sm:grid-cols-2'>
        <CatalogValue label={t('Endpoint')}>
          <span className='inline-flex items-center gap-2'>
            <Route className='text-muted-foreground size-4' />
            <code className='font-mono text-xs'>{endpoint}</code>
          </span>
        </CatalogValue>
        <CatalogValue label={t('Rate limits')}>
          <span className='inline-flex items-center gap-2'>
            <Gauge className='text-muted-foreground size-4' />—
          </span>
        </CatalogValue>
      </section>
    </div>
  )
}

export function ModelCatalogDetailsDrawer(props: {
  model: PlatformModel | null
  onOpenChange: (open: boolean) => void
  tokenUnit: TokenUnit
  priceRate: number
  usdExchangeRate: number
}) {
  const { t } = useTranslation()
  const model = props.model

  return (
    <Sheet open={Boolean(model)} onOpenChange={props.onOpenChange}>
      <SheetContent side='right' className='w-full gap-0 p-0 sm:max-w-2xl'>
        {model ? (
          <>
            <SheetHeader className='border-border/70 border-b px-5 py-4 sm:px-6'>
              <div className='flex min-w-0 items-center gap-2 pr-9'>
                <Layers className='text-muted-foreground size-5 shrink-0' />
                <SheetTitle className='truncate'>
                  {model.display_name}
                </SheetTitle>
                <CopyButton
                  value={model.public_model_id}
                  size='icon'
                  className='size-7'
                  iconClassName='size-3.5'
                  tooltip={t('Copy full model ID')}
                  successTooltip={t('Model ID copied')}
                  aria-label={t('Copy full model ID: {{modelId}}', {
                    modelId: model.public_model_id,
                  })}
                />
              </div>
              <SheetDescription className='font-mono text-xs break-all'>
                {model.public_model_id}
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue='overview' className='min-h-0 flex-1 gap-0'>
              <TabsList className='bg-muted/50 mx-5 mt-4 grid w-auto grid-cols-3 rounded-xl p-1 sm:mx-6'>
                <TabsTrigger value='overview'>{t('Overview')}</TabsTrigger>
                <TabsTrigger value='performance'>
                  {t('Performance')}
                </TabsTrigger>
                <TabsTrigger value='api'>{t('API')}</TabsTrigger>
              </TabsList>
              <div className='min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6'>
                <TabsContent value='overview'>
                  <ModelOverview
                    model={model}
                    tokenUnit={props.tokenUnit}
                    priceRate={props.priceRate}
                    usdExchangeRate={props.usdExchangeRate}
                  />
                </TabsContent>
                <TabsContent value='performance'>
                  <ModelPerformance />
                </TabsContent>
                <TabsContent value='api'>
                  <ModelApi model={model} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
