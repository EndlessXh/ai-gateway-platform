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
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import type { PromptCacheInfo } from '../types'

export function PromptCacheGuidance(props: {
  providerKey: string
  promptCache?: PromptCacheInfo
}) {
  const { t } = useTranslation()
  const promptCacheSource =
    props.promptCache?.source === 'measurement'
      ? t('Measurement')
      : t('Anthropic documentation')

  if (props.promptCache) {
    return (
      <Alert>
        <AlertTitle>{t('Prompt caching (Anthropic)')}</AlertTitle>
        <AlertDescription>
          <dl className='mt-3 grid gap-3 sm:grid-cols-3'>
            <div>
              <dt className='text-muted-foreground text-xs'>
                {t('Minimum cacheable prompt')}
              </dt>
              <dd className='mt-1 font-medium'>
                {t('{{count}} tokens', {
                  count: props.promptCache.minimum_tokens,
                })}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground text-xs'>{t('Source')}</dt>
              <dd className='mt-1 font-medium'>{promptCacheSource}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground text-xs'>{t('Checked')}</dt>
              <dd className='mt-1 font-medium'>
                {props.promptCache.checked_at}
              </dd>
            </div>
          </dl>
          <p className='mt-3'>
            {t(
              'A development measurement found cache hits cost about 91.6% less than cache writes.'
            )}
          </p>
          <p>{t('Short conversations usually do not reach this threshold.')}</p>
        </AlertDescription>
      </Alert>
    )
  }

  if (props.providerKey === 'anthropic') {
    return (
      <Alert>
        <AlertTitle>{t('Prompt caching (Anthropic)')}</AlertTitle>
        <AlertDescription>
          {t(
            'The threshold for this Anthropic model has not been published or measured.'
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert>
      <AlertTitle>{t('Prompt caching')}</AlertTitle>
      <AlertDescription>
        {t(
          "This page only maintains explicit prompt-cache thresholds for Anthropic models. Other providers may use automatic or different caching mechanisms. Their thresholds and billing rules have not been verified here; consult the provider's official documentation."
        )}
      </AlertDescription>
    </Alert>
  )
}
