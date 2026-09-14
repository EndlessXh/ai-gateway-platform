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
import {
  ChartNoAxesCombined,
  KeyRound,
  Layers,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  PublicChip,
  PublicFeaturePanel,
  PublicSectionHeader,
} from '@/components/public/section'

/*
  Capability grid.

  Replaces a six-cell uniform icon grid. Each panel now carries a different
  internal visual — protocol chips, a control list, alias rows, a metric row —
  because a grid where every cell is icon + title + one line reads as a
  template no matter how it is styled.

  Only capabilities this deployment actually has appear here. Nothing implies
  an upstream provider that is not connected.
*/

/** Supporting row beneath the panels: icon, label, one line, no card. */
const SUPPORTING = [
  {
    icon: Layers,
    title: 'Routing architecture',
    body: 'Channel selection sits behind the public alias, so upstreams can change without client edits.',
  },
  {
    icon: ChartNoAxesCombined,
    title: 'Transparent usage',
    body: 'Every relayed request writes a consumption log and a quota movement.',
  },
  {
    icon: ShieldCheck,
    title: 'Scoped credentials',
    body: 'Keys carry model limits, quota ceilings and expiry.',
  },
  {
    icon: KeyRound,
    title: 'Open to extension',
    body: 'The channel layer accepts further adapters; availability follows configuration.',
  },
] as const

const TOKEN_CONTROLS = [
  'Model allow-list per token',
  'Quota ceiling per token',
  'Expiry and revocation',
] as const

const VISIBILITY = [
  'Usage logs',
  'Quota statistics',
  'Wallet',
  'Subscriptions',
] as const

export function Features() {
  const { t } = useTranslation()

  return (
    <section className='relative z-10 px-6 py-24 md:py-32'>
      <div className='mx-auto max-w-6xl'>
        <PublicSectionHeader
          side
          className='mb-12'
          eyebrow={t('Verified platform surface')}
          title={t('Built for developers, observable end to end')}
          lede={t(
            'Current capabilities are separated from extensible architecture so future channel support is never presented as already available.'
          )}
        />

        <div className='grid gap-4 lg:grid-cols-12'>
          <PublicFeaturePanel
            emphasis
            className='lg:col-span-7'
            index='01'
            title={t('Compatible request formats')}
            description={t(
              'Chat-compatible requests and a Messages-compatible entry are available through the gateway.'
            )}
          >
            <div className='flex flex-wrap gap-2'>
              <PublicChip mono>POST /v1/chat/completions</PublicChip>
              <PublicChip mono>POST /v1/messages</PublicChip>
              <PublicChip>
                <span className='bg-success me-1.5 size-1.5 rounded-full' />
                {t('SSE verified')}
              </PublicChip>
            </div>
          </PublicFeaturePanel>

          <PublicFeaturePanel
            className='lg:col-span-5'
            index='02'
            title={t('Scoped API tokens')}
            description={t(
              'Create tokens with model access, quota limits, and expiration controls.'
            )}
          >
            <ul className='text-muted-foreground space-y-2 text-sm'>
              {TOKEN_CONTROLS.map((item) => (
                <li key={item} className='flex items-center gap-2'>
                  <span className='bg-primary/60 size-1 shrink-0 rounded-full' />
                  {t(item)}
                </li>
              ))}
            </ul>
          </PublicFeaturePanel>

          <PublicFeaturePanel
            className='lg:col-span-5'
            index='03'
            title={t('Neutral model routing')}
            description={t(
              'Platform aliases keep client integrations separate from the selected upstream channel.'
            )}
          >
            <div className='space-y-2'>
              {['platform-general-preview', 'platform-reasoning-preview'].map(
                (alias) => (
                  <div
                    key={alias}
                    className='border-border/60 bg-background/60 flex items-center justify-between gap-2 rounded-lg border px-3 py-2'
                  >
                    <span className='data-value truncate text-xs'>{alias}</span>
                    <span className='text-muted-foreground/70 shrink-0 text-[11px]'>
                      {t('routed')}
                    </span>
                  </div>
                )
              )}
            </div>
          </PublicFeaturePanel>

          <PublicFeaturePanel
            emphasis
            className='lg:col-span-7'
            index='04'
            title={t('Usage and quota visibility')}
            description={t(
              'Consumption logs and quota statistics show what happened after a request.'
            )}
          >
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
              {VISIBILITY.map((item) => (
                <div
                  key={item}
                  className='border-border/60 bg-background/60 rounded-lg border px-3 py-2 text-center text-xs'
                >
                  {t(item)}
                </div>
              ))}
            </div>
          </PublicFeaturePanel>
        </div>

        {/* Supporting row: no cards, deliberately airy, matching the reference. */}
        <div className='mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4'>
          {SUPPORTING.map((item) => (
            <div key={item.title}>
              <item.icon className='text-primary size-5' aria-hidden='true' />
              <h3 className='mt-4 text-sm font-semibold'>{t(item.title)}</h3>
              <p className='text-muted-foreground mt-2 text-sm leading-6'>
                {t(item.body)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
