/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  BrainCircuit,
  Code2,
  Image,
  Music2,
  Network,
  Sparkles,
  Video,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

type ModelIdentityData = {
  public_model_id?: string
  model_name?: string
  display_name?: string
  provider_key?: string
  provider_label?: string
  icon_key?: string
}

const iconMap = {
  platform: Network,
  sparkles: Sparkles,
  brain: BrainCircuit,
  code: Code2,
  image: Image,
  audio: Music2,
  video: Video,
  embedding: Network,
} as const

const providerIconNames: Record<string, string> = {
  anthropic: 'Claude.Color',
  cohere: 'Cohere.Color',
  deepseek: 'DeepSeek.Color',
  google: 'Gemini.Color',
  meta: 'Meta.Color',
  'meta-llama': 'Meta.Color',
  minimax: 'Minimax.Color',
  mistralai: 'Mistral.Color',
  moonshotai: 'Moonshot.Color',
  openai: 'OpenAI.Color',
  qwen: 'Qwen.Color',
  tencent: 'Hunyuan.Color',
  'x-ai': 'Grok.Color',
  'z-ai': 'Zhipu.Color',
}

function providerIconName(model: ModelIdentityData): string | null {
  if (!model.provider_key) return null
  return (
    providerIconNames[model.provider_key] ??
    model.provider_label ??
    model.provider_key
  )
}

export function ModelIdentity({
  model,
  compact = false,
  prominent = false,
  className,
  nameClassName,
  meta,
}: {
  model: ModelIdentityData
  compact?: boolean
  /**
   * Opt-in, larger desktop icon chip (36px -> 40px at `sm:`) and a bolder
   * name, matching the reference model-square card. Every other caller
   * (e.g. `features/pricing/components/model-card.tsx`) omits this and keeps
   * the existing `compact`/default sizing untouched.
   */
  prominent?: boolean
  className?: string
  /**
   * Adds layout classes to the name heading. Catalog cards use this to place
   * the full model ID in their dedicated, full-width name row while retaining
   * this component's icon and metadata layout.
   */
  nameClassName?: string
  /**
   * Replaces the default provider label + full-ID row below the name. Pass
   * `undefined` (the default) to keep that row; pass a node (or `null`) to
   * render something else, or nothing, in its place.
   */
  meta?: React.ReactNode
}) {
  const { t } = useTranslation()
  const modelID = model.public_model_id ?? model.model_name ?? ''
  const displayName = model.display_name || modelID
  const hasDistinctDisplayName = displayName !== modelID
  const Icon = iconMap[model.icon_key as keyof typeof iconMap] ?? Network
  const providerIconNameValue = providerIconName(model)
  const providerIcon = providerIconNameValue
    ? getLobeIcon(providerIconNameValue, prominent ? 28 : 24)
    : null

  let iconSizeClass = 'size-11'
  if (prominent) {
    iconSizeClass = 'size-9 sm:size-10'
  } else if (compact) {
    iconSizeClass = 'size-9'
  }

  return (
    <div className={cn('flex min-w-0 items-start gap-3', className)}>
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10',
          providerIcon
            ? 'bg-muted/50 text-foreground'
            : 'bg-primary/8 text-primary',
          iconSizeClass
        )}
        aria-hidden={providerIcon ? undefined : true}
        aria-label={providerIcon ? model.provider_label : undefined}
        role={providerIcon ? 'img' : undefined}
      >
        {providerIcon ?? <Icon className={compact ? 'size-4' : 'size-5'} />}
      </div>
      <div className='min-w-0 flex-1'>
        <h3
          className={cn(
            'text-foreground truncate text-sm leading-5 sm:text-base',
            prominent ? 'font-bold' : 'font-semibold',
            nameClassName
          )}
          title={hasDistinctDisplayName ? undefined : modelID}
        >
          {displayName}
        </h3>
        {meta !== undefined ? (
          meta
        ) : (
          <>
            {model.provider_label ? (
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {model.provider_label}
              </p>
            ) : null}
            <div className='mt-1.5 flex min-w-0 items-start gap-1'>
              {hasDistinctDisplayName ? (
                <code
                  className='text-muted-foreground min-w-0 font-mono text-[11px] leading-4 break-all'
                  title={modelID}
                  data-testid='full-model-id'
                >
                  {modelID}
                </code>
              ) : null}
              <CopyButton
                value={modelID}
                size='icon'
                className='size-6'
                iconClassName='size-3'
                tooltip={t('Copy full model ID')}
                successTooltip={t('Model ID copied')}
                aria-label={t('Copy full model ID: {{modelId}}', {
                  modelId: modelID,
                })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
