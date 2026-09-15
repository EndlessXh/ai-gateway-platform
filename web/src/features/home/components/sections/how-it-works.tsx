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
import { Link } from '@tanstack/react-router'
import { KeyRound, ScrollText, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PublicSectionHeader } from '@/components/public/section'

/*
  Three-step onboarding.

  Condensed from four equal cells to three steps, matching the reference's
  rhythm and the actual shortest path to a first request. Each step links to a
  real destination — no decorative buttons.
*/
const STEPS = [
  {
    number: '01',
    icon: KeyRound,
    title: 'Create a token',
    description: 'Set model access, quota, and expiry before sharing a key.',
    to: '/keys',
    action: 'Go to API Keys',
  },
  {
    number: '02',
    icon: Send,
    title: 'Choose a platform alias',
    description:
      'Integrate with a stable, neutral model name instead of an upstream-specific identifier.',
    to: '/model-catalog',
    action: 'Browse models',
  },
  {
    number: '03',
    icon: ScrollText,
    title: 'Send a request and inspect usage',
    description:
      'Use the documented chat or messages route, then review logs and quota movement.',
    to: '/usage-logs',
    action: 'View usage logs',
  },
] as const

export function HowItWorks() {
  const { t } = useTranslation()

  return (
    <section className='border-border/40 relative z-10 border-t px-6 py-24 md:py-32'>
      <div className='mx-auto max-w-6xl'>
        <PublicSectionHeader
          align='center'
          className='mb-14'
          eyebrow={t('Request path')}
          title={t('Three steps to your first request')}
          lede={t(
            'From token creation to an auditable request, using the documented routes.'
          )}
        />

        <ol className='relative grid gap-10 md:grid-cols-3 md:gap-6'>
          {/*
            Connector sits behind the step markers and only exists on the
            three-column layout; on mobile the steps stack and a horizontal
            rule would be meaningless. Its offset tracks the marker, which
            grows at `lg`.

            Round 5: markers, numbers and copy all scale up from `lg`. At 1920
            this row read as 1440 content on a wider canvas — a 48px circle
            with a 20px glyph against ~240px of surrounding space.
          */}
          <div
            aria-hidden='true'
            className='via-border absolute inset-x-[16%] top-6 hidden h-px bg-gradient-to-r from-transparent to-transparent md:block lg:top-8'
          />

          {STEPS.map((step) => (
            <li key={step.number} className='relative text-center'>
              <div className='border-border bg-background text-primary relative mx-auto flex size-12 items-center justify-center rounded-full border lg:size-16'>
                <step.icon className='size-5 lg:size-7' aria-hidden='true' />
              </div>
              <span className='data-value text-muted-foreground/70 mt-4 block text-xs font-semibold lg:mt-5 lg:text-sm'>
                {step.number}
              </span>
              <h3 className='mt-2 text-base font-semibold lg:text-xl'>
                {t(step.title)}
              </h3>
              <p className='text-muted-foreground mx-auto mt-3 max-w-xs text-sm leading-6 lg:max-w-sm lg:text-base lg:leading-7'>
                {t(step.description)}
              </p>
              <Link
                to={step.to}
                className='text-primary mt-4 inline-block text-sm font-medium hover:underline lg:mt-5 lg:text-base'
              >
                {t(step.action)}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
