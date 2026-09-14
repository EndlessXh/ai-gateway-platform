/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { isTokenBasedModel } from '@/features/pricing/lib/model-helpers'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import type { PricingModel, TokenUnit } from '@/features/pricing/types'

import { formatContextTokens } from '../lib'
import type { PlatformModel } from '../types'
import { ModelIdentity } from './model-identity'

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

export function ModelCatalogCard(props: {
  model: PlatformModel
  tokenUnit: TokenUnit
  priceRate: number
  usdExchangeRate: number
  onDetails: () => void
  listView?: boolean
}) {
  const { t } = useTranslation()
  const { model } = props
  const priced = pricingModel(model)
  const unit = props.tokenUnit === 'K' ? 'K' : 'M'
  const endpoint =
    model.category === 'embedding' ? '/v1/embeddings' : '/v1/chat/completions'
  const isTokenBased = priced ? isTokenBasedModel(priced) : false
  const hasCachePrice = isTokenBased && priced?.cache_ratio != null
  const contextTokens = formatContextTokens(model.context_tokens)

  let priceSummary: ReactNode
  if (!priced) {
    priceSummary = (
      <span className='text-muted-foreground text-sm'>
        {t('Pricing unavailable')}
      </span>
    )
  } else if (isTokenBased) {
    priceSummary = (
      <>
        <span className='text-muted-foreground whitespace-nowrap'>
          {t('Input')}{' '}
          <span className='text-foreground font-mono font-semibold'>
            {formatPrice(
              priced,
              'input',
              unit,
              false,
              props.priceRate,
              props.usdExchangeRate
            )}
          </span>
          {`/1${unit}`}
        </span>
        <span className='text-muted-foreground whitespace-nowrap'>
          {t('Output')}{' '}
          <span className='text-foreground font-mono font-semibold'>
            {formatPrice(
              priced,
              'output',
              unit,
              false,
              props.priceRate,
              props.usdExchangeRate
            )}
          </span>
          {`/1${unit}`}
        </span>
        {hasCachePrice ? (
          <span className='text-muted-foreground/60 whitespace-nowrap'>
            {t('Cached')}{' '}
            <span className='font-mono'>
              {formatPrice(
                priced,
                'cache',
                unit,
                false,
                props.priceRate,
                props.usdExchangeRate
              )}
            </span>
          </span>
        ) : null}
      </>
    )
  } else {
    priceSummary = (
      <span className='text-muted-foreground whitespace-nowrap'>
        <span className='text-foreground font-mono font-semibold'>
          {formatRequestPrice(
            priced,
            false,
            props.priceRate,
            props.usdExchangeRate
          )}
        </span>{' '}
        / {t('request')}
      </span>
    )
  }

  let billingTypeLabel: string | null = null
  if (priced) {
    billingTypeLabel = isTokenBased ? t('Metered per token') : t('Per request')
  }

  return (
    <article className='group hover:bg-muted/20 relative flex min-w-0 flex-col rounded-xl border p-3 transition-colors sm:p-5'>
      <h3
        className='text-foreground truncate font-mono text-sm leading-5 font-bold tracking-tighter'
        title={model.public_model_id}
        data-testid='model-catalog-name'
      >
        {model.public_model_id}
      </h3>
      <div className='flex items-start justify-between gap-2.5 sm:gap-3'>
        <ModelIdentity
          prominent
          model={model}
          className='min-w-0 flex-1'
          nameClassName='hidden'
          meta={
            <div className='mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs sm:mt-1 sm:gap-x-3'>
              {priceSummary}
            </div>
          }
        />
        <div className='flex shrink-0 items-center gap-1.5'>
          <button
            type='button'
            onClick={props.onDetails}
            className='text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors sm:px-2.5 sm:py-1.5'
          >
            {t('Details')}
            <ChevronRight className='size-3.5' />
          </button>
          <CopyButton
            value={model.public_model_id}
            variant='outline'
            size='icon'
            className='size-7 rounded-md'
            iconClassName='size-3.5'
            tooltip={t('Copy full model ID')}
            successTooltip={t('Model ID copied')}
            aria-label={t('Copy full model ID: {{modelId}}', {
              modelId: model.public_model_id,
            })}
          />
        </div>
      </div>

      <p className='text-muted-foreground mt-2 line-clamp-1 flex-1 text-xs leading-relaxed sm:mt-4 sm:line-clamp-2 sm:min-h-10'>
        {model.description || t('No description available.')}
      </p>

      <div className='mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 sm:mt-4'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          {billingTypeLabel ? (
            <span className='text-muted-foreground text-xs font-medium'>
              {billingTypeLabel}
            </span>
          ) : null}
          <span className='text-muted-foreground text-xs'>
            {t('Context')}{' '}
            <span className='data-value text-foreground font-medium'>
              {contextTokens ?? t('Unknown')}
            </span>
          </span>
        </div>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 sm:gap-x-3 sm:gap-y-1'>
          <code className='text-muted-foreground/70 font-mono text-xs whitespace-nowrap'>
            {endpoint}
          </code>
          <span className='text-muted-foreground/50 text-xs'>{`1${unit}`}</span>
        </div>
      </div>
    </article>
  )
}
