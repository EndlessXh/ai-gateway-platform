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
import { LockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  const { status } = useStatus()

  if (status?.register_enabled === false) {
    return (
      <AuthLayout>
        <div className='border-border bg-elevated rounded-xl border p-6 shadow-[var(--shadow-surface)] sm:p-8'>
          <LockKeyhole className='text-warning size-6' aria-hidden='true' />
          <h2 className='mt-6 text-2xl font-semibold tracking-tight'>
            {t('Registration is currently closed')}
          </h2>
          <p className='text-muted-foreground mt-3 text-sm leading-6'>
            {t(
              'New accounts cannot be created from this deployment right now. Existing users can still sign in.'
            )}
          </p>
          <Link
            to='/sign-in'
            className='text-primary mt-6 inline-flex min-h-11 items-center font-medium underline underline-offset-4'
          >
            {t('Return to sign in')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className='bg-elevated border-border w-full space-y-8 rounded-xl border p-6 shadow-[var(--shadow-surface)] sm:p-8'>
        <div className='space-y-2'>
          <h2 className='text-2xl font-semibold tracking-tight'>
            {t('Create an account')}
          </h2>
          <p className='text-muted-foreground text-sm sm:text-base'>
            {t('Already have an account?')}{' '}
            <Link
              to='/sign-in'
              className='hover:text-primary font-medium underline underline-offset-4'
            >
              {t('Sign in')}
            </Link>
            .
          </p>
        </div>

        <SignUpForm />

        <TermsFooter
          variant='sign-up'
          status={status}
          className='text-center'
        />
      </div>
    </AuthLayout>
  )
}
