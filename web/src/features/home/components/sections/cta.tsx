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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

interface CTAProps {
  className?: string
  isAuthenticated?: boolean
}

export function CTA(props: CTAProps) {
  const { t } = useTranslation()

  return (
    /*
      Closing CTA. Centred with a soft wash rather than the previous solid dark
      slab, so it echoes the hero at the other end of the page instead of
      reading as a separate banner. The accent is the shared brand gradient —
      no extra glow, no second gradient vocabulary.
    */
    <section className='relative z-10 overflow-hidden px-6 py-24 md:py-32'>
      {/*
        Round 4: this wash mixed `--chart-2`, which read teal and was the last
        large green-adjacent area on the page. It now uses the same neutral
        tint pair as `ambient-field` (`--tint-primary`/`--tint-secondary`) so
        the top and bottom of the page bookend each other, and it is taller so
        the closing block carries real weight.
      */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[34rem]'
        style={{
          background:
            'radial-gradient(56rem 26rem at 50% 104%, color-mix(in oklch, var(--tint-primary) 24%, transparent), transparent 66%), radial-gradient(40rem 20rem at 78% 100%, color-mix(in oklch, var(--tint-secondary) 14%, transparent), transparent 70%)',
        }}
      />
      <div className='mx-auto max-w-2xl text-center'>
        <p className='type-label text-brand-accent mb-5'>
          {t('Developer access')}
        </p>
        <h2 className='type-section-title mx-auto max-w-3xl'>
          <span className='block'>
            {props.isAuthenticated
              ? t('Continue from the console')
              : t('Ready to route your AI traffic')}
          </span>
          <span className='text-gradient-brand block'>
            {t('through one gateway?')}
          </span>
        </h2>
        <p className='text-muted-foreground mx-auto mt-5 max-w-xl text-sm leading-6 md:text-base md:leading-7'>
          {t(
            'Review provisional model pricing before sending traffic, then inspect every request from the usage log.'
          )}
        </p>
        <div className='mt-8 flex flex-col justify-center gap-3 sm:flex-row'>
          <Button
            size='lg'
            className='min-h-11 justify-center'
            render={
              <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
            }
          >
            {props.isAuthenticated ? t('Open Dashboard') : t('Create account')}
            <ArrowRight className='size-4' />
          </Button>
          <Button
            size='lg'
            variant='outline'
            className='min-h-11 justify-center'
            render={<Link to='/pricing' />}
          >
            {t('Review pricing')}
          </Button>
        </div>
      </div>
    </section>
  )
}
