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
import { ArrowRight, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { brandConfig } from '@/config/brand'
import { useStatus } from '@/hooks/use-status'

import { HeroTerminalDemo } from '../hero-terminal-demo'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const configuredDocs = status?.docs_link as string | undefined
  const docsUrl =
    configuredDocs === 'https://docs.newapi.pro'
      ? brandConfig.docsUrl
      : configuredDocs || brandConfig.docsUrl

  return (
    <section className='relative z-10 overflow-hidden px-6 pt-24 pb-16 md:pt-32 md:pb-24 lg:pt-36 lg:pb-28'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-8'>
        <div className='flex flex-col items-start text-left lg:col-span-6'>
          {/* Pill badge: sets category before the headline, as on the reference. */}
          <span className='border-border/70 bg-card/70 text-muted-foreground mb-7 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur'>
            <span className='bg-primary size-1.5 rounded-full' />
            {t('Unified AI API infrastructure')}
          </span>

          {/*
            Two deliberate lines instead of one long balanced block: the
            reference headline reads as a statement plus an accented object,
            and at large sizes a 5-line wrap loses all impact.
          */}
          <h1 className='type-hero'>
            <span className='block'>{t('One unified API gateway')}</span>
            <span className='text-gradient-brand block'>
              {t('for every AI request')}
            </span>
          </h1>

          <p className='text-muted-foreground reading-width mt-6 text-base leading-7 md:text-lg md:leading-8'>
            {t(brandConfig.description)}
          </p>

          <div className='mt-8 flex flex-col gap-3 sm:flex-row sm:items-center'>
            <Button
              size='lg'
              className='min-h-11 justify-center'
              render={
                <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
              }
            >
              {props.isAuthenticated ? t('Go to Dashboard') : t('Get Started')}
              <ArrowRight className='size-4' />
            </Button>
            <Button
              size='lg'
              variant='outline'
              className='min-h-11 justify-center'
              render={<Link to='/pricing' />}
            >
              {t('View Pricing')}
            </Button>
            <Button
              size='lg'
              variant='ghost'
              className='min-h-11 justify-center'
              render={
                docsUrl.startsWith('http') ? (
                  <a href={docsUrl} target='_blank' rel='noopener noreferrer' />
                ) : (
                  <Link to={docsUrl} />
                )
              }
            >
              <BookOpen className='size-4' />
              {t('Documentation')}
            </Button>
          </div>

          {/*
            Compatibility row. The reference puts client logos here; we list the
            request surfaces we actually relay, which is the same reassurance
            without implying partnerships that do not exist.
          */}
          <div className='mt-10'>
            <p className='text-muted-foreground/80 text-xs font-medium'>
              {t('Works with existing clients')}
            </p>
            <p className='text-muted-foreground/70 mt-1 text-xs'>
              {t(
                'Point any OpenAI- or Messages-compatible client at the gateway base URL.'
              )}
            </p>
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              {[
                { label: 'OpenAI-compatible', path: '/v1/chat/completions' },
                { label: 'Messages-compatible', path: '/v1/messages' },
              ].map((item) => (
                <span
                  key={item.path}
                  className='border-border/70 bg-card/60 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs backdrop-blur'
                >
                  <span className='font-medium'>{t(item.label)}</span>
                  <span className='text-muted-foreground/70 font-mono text-[11px]'>
                    {item.path}
                  </span>
                </span>
              ))}
              <Link
                to='/model-catalog'
                className='text-muted-foreground hover:text-foreground border-border/70 inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1.5 text-xs transition-colors'
              >
                {t('Browse models')}
                <ArrowRight className='size-3' />
              </Link>
            </div>
          </div>
        </div>

        <HeroTerminalDemo className='lg:col-span-6' />
      </div>
    </section>
  )
}
