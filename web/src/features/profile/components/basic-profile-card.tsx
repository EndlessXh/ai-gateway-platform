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
import { Loader2, Pencil, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TitledCard } from '@/components/ui/titled-card'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import dayjs from '@/lib/dayjs'

import type { UserProfile } from '../types'

interface BasicProfileCardProps {
  profile: UserProfile
  updating: boolean
  onSave: (data: { display_name: string }) => Promise<boolean>
}

export function BasicProfileCard({
  profile,
  updating,
  onSave,
}: BasicProfileCardProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(profile.display_name || '')

  useEffect(
    () => setDisplayName(profile.display_name || ''),
    [profile.display_name]
  )

  const cancel = () => {
    setDisplayName(profile.display_name || '')
    setEditing(false)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = displayName.trim()
    if (!value) {
      toast.error(t('Display name is required'))
      return
    }
    if (value.length > 20) {
      toast.error(t('Display name must be 20 characters or fewer'))
      return
    }
    if (await onSave({ display_name: value })) setEditing(false)
  }

  const createdAt = profile.created_at || profile.created_time
  const status = profile.status === 1 ? t('Enabled') : t('Restricted')
  const avatarName = profile.username || profile.display_name

  return (
    <TitledCard
      title={t('Basic profile')}
      description={t(
        'Review your account identity and edit supported profile fields.'
      )}
      icon={<UserRound className='size-4' />}
      iconTone='info'
      disableHoverEffect
      action={
        !editing ? (
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setEditing(true)}
          >
            <Pencil />
            {t('Edit profile')}
          </Button>
        ) : null
      }
    >
      <form onSubmit={submit} className='space-y-5'>
        <div className='flex items-center gap-3 rounded-lg border p-3'>
          <Avatar className='size-12 rounded-xl'>
            <AvatarFallback
              className='rounded-xl font-semibold text-white'
              style={getUserAvatarStyle(avatarName)}
            >
              {getUserAvatarFallback(avatarName)}
            </AvatarFallback>
          </Avatar>
          <div className='min-w-0'>
            <p className='font-medium'>
              {profile.display_name || profile.username}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Avatar is generated from your account identity; custom uploads are not supported.'
              )}
            </p>
          </div>
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <ReadOnlyField label={t('Username')} value={profile.username} />
          <div className='space-y-2'>
            <Label htmlFor='profile-display-name'>{t('Display name')}</Label>
            <Input
              id='profile-display-name'
              value={displayName}
              maxLength={20}
              disabled={!editing || updating}
              autoComplete='name'
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <ReadOnlyField
            label={t('Email')}
            value={profile.email || t('Not bound')}
          />
          <ReadOnlyField
            label={t('User group')}
            value={profile.group || t('Default')}
          />
          <div className='space-y-2'>
            <Label>{t('Account status')}</Label>
            <div className='flex h-9 items-center rounded-md border px-3'>
              <StatusBadge
                label={status}
                variant={profile.status === 1 ? 'success' : 'warning'}
                copyable={false}
              />
            </div>
          </div>
          <ReadOnlyField
            label={t('Created')}
            value={
              createdAt
                ? dayjs.unix(createdAt).format('YYYY-MM-DD HH:mm')
                : t('Unavailable')
            }
          />
        </div>
        {editing && (
          <div className='flex justify-end gap-2 border-t pt-4'>
            <Button
              type='button'
              variant='outline'
              disabled={updating}
              onClick={cancel}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              disabled={
                updating ||
                !displayName.trim() ||
                displayName.trim() === (profile.display_name || '')
              }
            >
              {updating && <Loader2 className='animate-spin' />}
              {updating ? t('Saving...') : t('Save changes')}
            </Button>
          </div>
        )}
      </form>
    </TitledCard>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className='space-y-2'>
      <Label>{label}</Label>
      <div className='bg-muted/30 flex min-h-9 items-center rounded-md border px-3 text-sm'>
        {value}
      </div>
    </div>
  )
}
