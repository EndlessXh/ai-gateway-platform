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
import { ArrowRight, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { brandConfig } from '@/config/brand'

type ErrorPageProps = {
  code: string
  eyebrow: string
  title: string
  description: string
  primaryTo?: '/' | '/dashboard' | '/sign-in'
  primaryLabel?: string
  onRetry?: () => void
  embedded?: boolean
  showConsole?: boolean
  showSignIn?: boolean
}

export function ErrorPage(props: ErrorPageProps) {
  const { t } = useTranslation()

  const Root = props.embedded ? 'section' : 'main'

  return (
    <Root className='bg-background flex min-h-[70svh] items-center py-16'>
      <div className='page-container grid gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:items-end'>
        <p className='data-value text-primary text-[clamp(5rem,18vw,12rem)] leading-none font-semibold tracking-[-0.08em]'>
          {props.code}
        </p>
        <div className='max-w-2xl border-t pt-8'>
          <p className='type-label text-brand-accent'>{t(props.eyebrow)}</p>
          <h1 className='type-page-title mt-5'>{t(props.title)}</h1>
          <p className='text-muted-foreground mt-5 max-w-xl text-base leading-7'>
            {t(props.description)}
          </p>
          <div className='mt-8 flex flex-col gap-3 sm:flex-row'>
            {props.onRetry ? (
              <Button size='lg' onClick={props.onRetry}>
                <RotateCcw className='size-4' />
                {t('Retry')}
              </Button>
            ) : null}
            {props.primaryTo ? (
              <Button size='lg' render={<Link to={props.primaryTo} />}>
                {t(props.primaryLabel || 'Back to Home')}
                <ArrowRight className='size-4' />
              </Button>
            ) : null}
            <Button size='lg' variant='outline' render={<Link to='/' />}>
              {t('Home')}
            </Button>
            {props.showConsole ? (
              <Button
                size='lg'
                variant='outline'
                render={<Link to='/dashboard' />}
              >
                {t('Console')}
              </Button>
            ) : null}
            {props.showSignIn ? (
              <Button
                size='lg'
                variant='outline'
                render={<Link to='/sign-in' />}
              >
                {t('Sign in')}
              </Button>
            ) : null}
            <Button
              size='lg'
              variant='ghost'
              render={
                brandConfig.docsUrl.startsWith('http') ? (
                  <a
                    href={brandConfig.docsUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                ) : (
                  <Link to={brandConfig.docsUrl} />
                )
              }
            >
              {t('Documentation')}
            </Button>
          </div>
        </div>
      </div>
    </Root>
  )
}
