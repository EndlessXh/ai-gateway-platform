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
import { Braces, ChartNoAxesCombined, Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Footer } from '@/components/layout/components/footer'
import { ThemeSwitch } from '@/components/theme-switch'
import { Skeleton } from '@/components/ui/skeleton'
import { resolveProductLogo, resolveProductName } from '@/config/brand'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()
  const displayName = resolveProductName(systemName)
  const displayLogo = resolveProductLogo(logo)

  return (
    /*
      The auth pages share the public site's ambient wash so signing in reads
      as part of the same product rather than a detached form page. No
      `bg-background` on this wrapper: `body` already paints it, and an opaque
      background here would occlude the negative-z ambient layer.
    */
    <div className='relative min-h-svh overflow-x-clip'>
      <div aria-hidden='true' className='ambient-field' />
      <header className='page-container relative flex h-16 items-center justify-between'>
        <Link
          to='/'
          className='flex items-center gap-2.5 rounded-sm font-semibold tracking-tight'
        >
          <div className='relative size-8'>
            {loading ? (
              <Skeleton className='absolute inset-0 rounded-lg' />
            ) : (
              <img
                src={displayLogo}
                alt={t('{{name}} logo', { name: displayName })}
                className='size-8 rounded-lg object-contain'
              />
            )}
          </div>
          {loading ? <Skeleton className='h-5 w-24' /> : displayName}
        </Link>
        <ThemeSwitch />
      </header>

      <main className='page-container grid min-h-[calc(100svh-4rem)] border-y lg:grid-cols-[minmax(0,0.9fr)_minmax(30rem,1.1fr)]'>
        {/*
          The narrative was `lg:flex`, so between 768 and 1023 it disappeared
          entirely and the form card floated in the middle of an otherwise
          empty column — measured at 768x1024: 342px card in 960px of main,
          36% fill, 309px dead space above and below.

          It is now a full-width band above the form at tablet widths and the
          left column from `lg` up, so the same markup serves both instead of
          the copy being duplicated. Still hidden below `md`: at 390 the form
          must come first.
        */}
        <aside className='bg-surface hidden flex-col justify-between gap-8 border-b p-8 md:flex lg:gap-10 lg:border-r lg:border-b-0 lg:p-10 xl:p-14'>
          <div>
            <p className='type-label text-brand-accent mb-5'>
              {t('Gateway access')}
            </p>
            <h1 className='type-page-title max-w-lg'>
              {t('Credentials are the control plane for every request.')}
            </h1>
            <p className='text-muted-foreground mt-5 max-w-lg leading-7'>
              {t(
                'Sign in to manage scoped API tokens, inspect usage, and review quota movement.'
              )}
            </p>
          </div>
          {/* Horizontal in the band, vertical once it becomes a column. */}
          <ul className='flex flex-wrap gap-x-8 gap-y-3 text-sm lg:flex-col lg:gap-5'>
            <li className='flex items-center gap-3'>
              <Route className='text-brand-accent size-5' aria-hidden='true' />
              {t('Neutral model routing')}
            </li>
            <li className='flex items-center gap-3'>
              <Braces className='text-brand-accent size-5' aria-hidden='true' />
              {t('Compatible API formats')}
            </li>
            <li className='flex items-center gap-3'>
              <ChartNoAxesCombined
                className='text-brand-accent size-5'
                aria-hidden='true'
              />
              {t('Usage and quota visibility')}
            </li>
          </ul>
        </aside>

        <div className='flex items-center px-4 py-10 sm:px-8 md:py-14 lg:px-12 xl:px-20'>
          {/* Slightly wider from `sm` up: once the narrative sits above rather
              than beside, a 28rem card reads as a strip in a wide column. */}
          <div className='mx-auto w-full max-w-md sm:max-w-lg'>{children}</div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
