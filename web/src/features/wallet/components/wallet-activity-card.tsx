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
import { ArrowUpRight, History, RefreshCw, ReceiptText } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import dayjs from '@/lib/dayjs'
import { formatQuota } from '@/lib/format'

import { getPaymentMethodName, getStatusConfig } from '../lib/billing'
import type { WalletActivityData } from '../types'

interface WalletActivityCardProps {
  data: WalletActivityData
  loading: boolean
  onRefresh: () => void
  onOpenBilling: () => void
}

export function WalletActivityCard({
  data,
  loading,
  onRefresh,
  onOpenBilling,
}: WalletActivityCardProps) {
  const { t } = useTranslation()
  let consumptionContent: ReactNode
  if (loading) {
    consumptionContent = <ActivitySkeleton />
  } else if (data.recent_consumption === null) {
    consumptionContent = <Unavailable />
  } else if (data.recent_consumption.length === 0) {
    consumptionContent = (
      <EmptyState text={t('No consumption recorded today')} />
    )
  } else {
    consumptionContent = (
      <div className='divide-y'>
        {data.recent_consumption.map((record) => (
          <div
            key={`${record.id}-${record.request_id ?? record.created_at}`}
            className='flex items-center justify-between gap-3 py-3'
          >
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium'>
                {record.model_name || t('API request')}
              </p>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {dayjs.unix(record.created_at).format('YYYY-MM-DD HH:mm')}
                {' · '}
                {record.is_stream ? t('Streaming') : t('Non-streaming')}
              </p>
            </div>
            <span className='shrink-0 font-mono text-sm font-semibold tabular-nums'>
              −{formatQuota(record.quota)}
            </span>
          </div>
        ))}
      </div>
    )
  }

  let topupContent: ReactNode
  if (loading) {
    topupContent = <ActivitySkeleton />
  } else if (data.recent_topups === null) {
    topupContent = <Unavailable />
  } else if (data.recent_topups.length === 0) {
    topupContent = <EmptyState text={t('No top-up records yet')} />
  } else {
    topupContent = (
      <div className='divide-y'>
        {data.recent_topups.map((record) => {
          const status = getStatusConfig(record.status)
          return (
            <div
              key={record.id}
              className='flex items-center justify-between gap-3 py-3'
            >
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium'>
                  {getPaymentMethodName(record.payment_method, t)}
                </p>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  {dayjs.unix(record.create_time).format('YYYY-MM-DD HH:mm')}
                </p>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <span className='font-mono text-sm font-semibold tabular-nums'>
                  +{formatQuota(record.amount)}
                </span>
                <StatusBadge
                  label={status.label}
                  variant={status.variant}
                  copyable={false}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardHeader className='flex-row items-start justify-between gap-3 border-b p-4 sm:p-5'>
        <div>
          <CardTitle>{t('Account activity')}</CardTitle>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              'Recent consumption and top-up records from the billing ledger.'
            )}
          </p>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          onClick={onRefresh}
          disabled={loading}
          aria-label={t('Refresh account activity')}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </Button>
      </CardHeader>
      <CardContent className='p-0'>
        {data.failed_sources.length > 0 && !loading && (
          <Alert className='m-4 sm:m-5'>
            <AlertDescription>
              {t(
                'Some account activity could not be refreshed. Unavailable values are not shown as zero.'
              )}
            </AlertDescription>
          </Alert>
        )}
        <div className='grid lg:grid-cols-2 lg:divide-x'>
          <section
            className='min-w-0 p-4 sm:p-5'
            aria-labelledby='recent-usage'
          >
            <div className='mb-3 flex items-center justify-between gap-2'>
              <h2
                id='recent-usage'
                className='flex items-center gap-2 font-medium'
              >
                <History className='text-muted-foreground size-4' />
                {t('Recent consumption')}
              </h2>
              <Button
                variant='link'
                size='sm'
                className='h-auto px-0'
                render={<a href='/usage-logs/common' />}
              >
                {t('View usage logs')}
                <ArrowUpRight />
              </Button>
            </div>
            {consumptionContent}
          </section>

          <section
            className='min-w-0 border-t p-4 sm:p-5 lg:border-t-0'
            aria-labelledby='recent-topups'
          >
            <div className='mb-3 flex items-center justify-between gap-2'>
              <h2
                id='recent-topups'
                className='flex items-center gap-2 font-medium'
              >
                <ReceiptText className='text-muted-foreground size-4' />
                {t('Recent top-ups')}
              </h2>
              <Button
                variant='link'
                size='sm'
                className='h-auto px-0'
                onClick={onOpenBilling}
              >
                {t('Billing history')}
                <ArrowUpRight />
              </Button>
            </div>
            {topupContent}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

function ActivitySkeleton() {
  return (
    <div className='space-y-3'>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className='flex items-center justify-between gap-4 py-1'
        >
          <div className='space-y-2'>
            <Skeleton className='h-4 w-32' />
            <Skeleton className='h-3 w-24' />
          </div>
          <Skeleton className='h-5 w-20' />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className='text-muted-foreground py-8 text-center text-sm'>{text}</p>
  )
}

function Unavailable() {
  const { t } = useTranslation()
  return <EmptyState text={t('Temporarily unavailable — retry to refresh.')} />
}
