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

import { Main } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { useAuthStore } from '@/stores/auth-store'

import { BasicProfileCard } from './components/basic-profile-card'
import { CheckinCalendarCard } from './components/checkin-calendar-card'
import { LanguagePreferencesCard } from './components/language-preferences-card'
import { LoginSessionsCard } from './components/login-sessions-card'
import { PasskeyCard } from './components/passkey-card'
import { ProfileHeader } from './components/profile-header'
import { ProfileSecurityCard } from './components/profile-security-card'
import { ProfileSettingsCard } from './components/profile-settings-card'
import { SidebarModulesCard } from './components/sidebar-modules-card'
import { TwoFACard } from './components/two-fa-card'
import { useProfile } from './hooks'

export function Profile() {
  const { t } = useTranslation()
  const {
    profile,
    loading,
    updating,
    error,
    fetchProfile,
    refreshProfile,
    updateProfile,
  } = useProfile()
  const { status } = useStatus()
  const permissions = useAuthStore((s) => s.auth.user?.permissions)

  const checkinEnabled = status?.checkin_enabled === true
  const turnstileEnabled = !!(
    status?.turnstile_check && status?.turnstile_site_key
  )
  const turnstileSiteKey = status?.turnstile_site_key || ''
  const canConfigureSidebar = permissions?.sidebar_settings !== false

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <CardStaggerContainer className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-6'>
          <CardStaggerItem>
            <ProfileHeader profile={profile} loading={loading} />
          </CardStaggerItem>

          {error && (
            <CardStaggerItem>
              <Alert>
                <AlertTitle>
                  {profile
                    ? t('Profile refresh incomplete')
                    : t('Unable to load profile')}
                </AlertTitle>
                <AlertDescription className='flex items-center justify-between gap-3'>
                  <span>
                    {profile
                      ? t(
                          'Showing the last confirmed profile. Some details could not be refreshed.'
                        )
                      : t(
                          'Your profile was not replaced with placeholder data.'
                        )}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => fetchProfile()}
                  >
                    {t('Retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            </CardStaggerItem>
          )}

          <CardStaggerItem>
            <div className='grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.46fr)] xl:items-start'>
              <div className='space-y-4 sm:space-y-6'>
                {profile && (
                  <BasicProfileCard
                    profile={profile}
                    updating={updating}
                    onSave={updateProfile}
                  />
                )}
                <ProfileSettingsCard
                  profile={profile}
                  loading={loading}
                  onProfileUpdate={refreshProfile}
                />
                <LanguagePreferencesCard
                  profile={profile}
                  onProfileUpdate={refreshProfile}
                />
                <ProfileSecurityCard profile={profile} loading={loading} />
                <LoginSessionsCard />
              </div>

              <div className='space-y-4 sm:space-y-6 xl:sticky xl:top-6'>
                {checkinEnabled && (
                  <CheckinCalendarCard
                    checkinEnabled={checkinEnabled}
                    turnstileEnabled={turnstileEnabled}
                    turnstileSiteKey={turnstileSiteKey}
                  />
                )}
                {canConfigureSidebar && <SidebarModulesCard />}
                <PasskeyCard loading={loading} />
                <TwoFACard loading={loading} />
              </div>
            </div>
          </CardStaggerItem>
        </CardStaggerContainer>
      </div>
    </Main>
  )
}
