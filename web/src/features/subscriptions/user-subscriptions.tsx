import { Link } from '@tanstack/react-router'
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
  CalendarClock,
  CircleGauge,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { selectOperationalText } from '@/i18n/languages'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'

import {
  cancelPlatformSubscription,
  getCurrentPlatformSubscriptions,
  getPlatformPlans,
  getPlatformSubscriptionEvents,
  getPlatformSubscriptionHistory,
  purchasePlatformSubscription,
  revokePlatformSubscriptionCancellation,
  renewPlatformSubscription,
  setPlatformSubscriptionAutoRenew,
} from './api'
import type {
  PlatformPublicPlan,
  PlatformSubscriptionEvent,
  PlatformSubscriptionRecord,
} from './types'

function stateLabel(state: string, t: (key: string) => string) {
  const labels: Record<string, string> = {
    active: t('Active'),
    canceling: t('Cancels at period end'),
    canceled: t('Cancelled'),
    expired: t('Expired'),
    renewal_failed: t('Renewal failed'),
  }
  return labels[state] || state
}

export function UserSubscriptions() {
  const { t, i18n } = useTranslation()
  const [plans, setPlans] = useState<PlatformPublicPlan[]>([])
  const [current, setCurrent] = useState<PlatformSubscriptionRecord[]>([])
  const [history, setHistory] = useState<PlatformSubscriptionRecord[]>([])
  const [pricingStatus, setPricingStatus] = useState('provisional')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)
  const idempotencyKeys = useRef(new Map<string, string>())
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [selectedEvents, setSelectedEvents] = useState<{
    subscriptionId: number
    events: PlatformSubscriptionEvent[]
  } | null>(null)

  const refresh = useCallback(async () => {
    const [planResponse, currentResponse, historyResponse, selfResponse] =
      await Promise.all([
        getPlatformPlans(i18n.resolvedLanguage ?? i18n.language),
        getCurrentPlatformSubscriptions(),
        getPlatformSubscriptionHistory(),
        getSelf(),
      ])
    setPlans(planResponse.data?.plans || [])
    setCurrent(currentResponse.data?.subscriptions || [])
    setHistory(historyResponse.data?.subscriptions || [])
    setWalletBalance(
      selfResponse.success && typeof selfResponse.data?.quota === 'number'
        ? selfResponse.data.quota
        : null
    )
    setPricingStatus(
      currentResponse.data?.pricing_status ||
        planResponse.data?.pricing_status ||
        'provisional'
    )
  }, [i18n.language, i18n.resolvedLanguage])

  useEffect(() => {
    void refresh()
      .catch(() => toast.error(t('Request failed')))
      .finally(() => setLoading(false))
  }, [refresh, t])

  const idempotencyKeyFor = (operation: string) => {
    const existing = idempotencyKeys.current.get(operation)
    if (existing) return existing
    const created = crypto.randomUUID()
    idempotencyKeys.current.set(operation, created)
    return created
  }

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    idempotent = false
  ) => {
    if (busyRef.current) return
    busyRef.current = key
    setBusy(key)
    try {
      await action()
      await refresh()
      if (idempotent) idempotencyKeys.current.delete(key)
      toast.success(t('Updated successfully'))
    } catch {
      toast.error(t('Request failed'))
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }

  const historicalOnly = useMemo(() => {
    const ids = new Set(current.map((item) => item.subscription.id))
    return history.filter((item) => !ids.has(item.subscription.id))
  }, [current, history])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('My subscription')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void run('refresh', refresh)}
          disabled={busy === 'refresh'}
        >
          <RefreshCw className={busy === 'refresh' ? 'animate-spin' : ''} />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-6xl space-y-6 pb-10'>
          {pricingStatus !== 'published' ? (
            <Alert>
              <ShieldCheck />
              <AlertDescription>
                {t(
                  'Plan pricing is provisional. Purchase and renewal actions remain disabled until pricing is published.'
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card data-card-hover='false'>
            <CardContent className='flex flex-wrap items-center justify-between gap-4 py-4'>
              <div>
                <p className='text-muted-foreground text-xs'>
                  {t('Wallet balance')}
                </p>
                <p className='mt-1 text-lg font-semibold tabular-nums'>
                  {walletBalance === null
                    ? t('Unavailable')
                    : formatQuota(walletBalance)}
                </p>
              </div>
              <Button
                variant='outline'
                size='sm'
                render={<Link to='/wallet' />}
              >
                {t('Open Wallet')}
              </Button>
            </CardContent>
          </Card>

          <section className='space-y-3'>
            <div>
              <h2 className='text-lg font-semibold'>{t('Current plan')}</h2>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Subscription quota is used independently before Wallet overflow.'
                )}
              </p>
            </div>
            {loading ? <Skeleton className='h-52 w-full' /> : null}
            {!loading && current.length === 0 ? (
              <Card data-card-hover='false'>
                <CardContent className='text-muted-foreground py-10 text-center text-sm'>
                  {t('No active subscription')}
                </CardContent>
              </Card>
            ) : null}
            {!loading && current.length > 0 ? (
              <div className='grid gap-4 lg:grid-cols-2'>
                {current.map((item) => {
                  const total = item.entitlements.quota_total
                  const used = item.entitlements.quota_used
                  const percent =
                    total > 0 ? Math.min(100, (used / total) * 100) : 0
                  const name = selectOperationalText(i18n.resolvedLanguage, {
                    en: item.lifecycle.name_en_snapshot,
                    zhCN: item.lifecycle.name_zh_snapshot,
                  })
                  return (
                    <Card key={item.subscription.id} data-card-hover='false'>
                      <CardHeader className='border-b'>
                        <div className='flex items-start justify-between gap-3'>
                          <div>
                            <CardTitle>{name}</CardTitle>
                            <p className='text-muted-foreground mt-1 font-mono text-xs'>
                              {item.lifecycle.plan_key_snapshot} · #
                              {item.subscription.id}
                            </p>
                          </div>
                          <Badge variant='outline'>
                            {stateLabel(item.lifecycle.lifecycle_state, t)}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-5 pt-5'>
                        <div className='grid grid-cols-2 gap-3 text-sm'>
                          <div className='bg-muted/50 rounded-lg p-3'>
                            <CircleGauge className='text-muted-foreground mb-2 size-4' />
                            <p className='text-muted-foreground text-xs'>
                              {t('Remaining')}
                            </p>
                            <p className='mt-1 font-semibold'>
                              {item.entitlements.quota_unlimited
                                ? t('Unlimited')
                                : formatQuota(
                                    item.entitlements.quota_remaining
                                  )}
                            </p>
                          </div>
                          <div className='bg-muted/50 rounded-lg p-3'>
                            <CalendarClock className='text-muted-foreground mb-2 size-4' />
                            <p className='text-muted-foreground text-xs'>
                              {t('Until')}
                            </p>
                            <p className='mt-1 text-sm font-semibold'>
                              {new Date(
                                item.subscription.end_time * 1000
                              ).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className='text-muted-foreground grid gap-1 text-xs sm:grid-cols-3'>
                          <p>
                            {t('Plan Price')}:{' '}
                            {Number(item.lifecycle.price_snapshot).toFixed(2)}{' '}
                            {item.lifecycle.currency_snapshot}
                          </p>
                          <p>
                            {t('Period start')}:{' '}
                            {new Date(
                              item.subscription.start_time * 1000
                            ).toLocaleString()}
                          </p>
                          <p>
                            {t('Days remaining')}:{' '}
                            {Math.max(
                              0,
                              Math.ceil(
                                (item.subscription.end_time -
                                  Date.now() / 1000) /
                                  86400
                              )
                            )}
                          </p>
                          <p>
                            {t('Model access group')}:{' '}
                            {item.entitlements.access_group ||
                              t('Account default')}
                          </p>
                        </div>
                        {!item.entitlements.quota_unlimited ? (
                          <div className='space-y-2'>
                            <div className='text-muted-foreground flex justify-between text-xs'>
                              <span>{t('Quota usage')}</span>
                              <span>{Math.round(percent)}%</span>
                            </div>
                            <Progress value={percent} />
                          </div>
                        ) : null}
                        <div className='flex items-center justify-between rounded-lg border p-3'>
                          <div>
                            <p className='text-sm font-medium'>
                              {t('Wallet auto-renew')}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              {t(
                                'One renewal attempt is made at the period boundary.'
                              )}
                            </p>
                          </div>
                          <Switch
                            checked={item.lifecycle.auto_renew}
                            disabled={
                              pricingStatus !== 'published' ||
                              item.lifecycle.lifecycle_state !== 'active' ||
                              busy !== null
                            }
                            onCheckedChange={(enabled) =>
                              void run(`auto-${item.subscription.id}`, () =>
                                setPlatformSubscriptionAutoRenew(
                                  item.subscription.id,
                                  enabled
                                )
                              )
                            }
                          />
                        </div>
                        {item.lifecycle.renewal_failure ? (
                          <Alert variant='destructive'>
                            <AlertDescription>
                              {item.lifecycle.renewal_failure}
                            </AlertDescription>
                          </Alert>
                        ) : null}
                        <div className='flex flex-wrap gap-2'>
                          <Button
                            size='sm'
                            disabled={
                              pricingStatus !== 'published' || busy !== null
                            }
                            onClick={() =>
                              void run(
                                `renew-${item.subscription.id}`,
                                () =>
                                  renewPlatformSubscription(
                                    item.subscription.id,
                                    idempotencyKeyFor(
                                      `renew-${item.subscription.id}`
                                    )
                                  ),
                                true
                              )
                            }
                          >
                            {t('Renew now')}
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={
                              item.lifecycle.lifecycle_state !== 'active' ||
                              busy !== null
                            }
                            onClick={() =>
                              void run(`cancel-${item.subscription.id}`, () =>
                                cancelPlatformSubscription(item.subscription.id)
                              )
                            }
                          >
                            {t('Cancel at period end')}
                          </Button>
                          {item.lifecycle.lifecycle_state === 'canceling' ? (
                            <Button
                              size='sm'
                              variant='outline'
                              disabled={busy !== null}
                              onClick={() =>
                                void run(`resume-${item.subscription.id}`, () =>
                                  revokePlatformSubscriptionCancellation(
                                    item.subscription.id
                                  )
                                )
                              }
                            >
                              {t('Resume subscription')}
                            </Button>
                          ) : null}
                          <Button
                            size='sm'
                            variant='ghost'
                            disabled={busy !== null}
                            onClick={() =>
                              void run(
                                `events-${item.subscription.id}`,
                                async () => {
                                  const response =
                                    await getPlatformSubscriptionEvents(
                                      item.subscription.id
                                    )
                                  setSelectedEvents({
                                    subscriptionId: item.subscription.id,
                                    events: response.data || [],
                                  })
                                }
                              )
                            }
                          >
                            {t('Events')}
                          </Button>
                        </div>
                        {selectedEvents?.subscriptionId ===
                        item.subscription.id ? (
                          <div className='space-y-2 rounded-lg border p-3'>
                            <div className='flex items-center justify-between gap-3'>
                              <p className='text-sm font-medium'>
                                {t('Subscription events')}
                              </p>
                              <Button
                                size='sm'
                                variant='ghost'
                                onClick={() => setSelectedEvents(null)}
                              >
                                {t('Close')}
                              </Button>
                            </div>
                            {selectedEvents.events.length === 0 ? (
                              <p className='text-muted-foreground text-xs'>
                                {t('No subscription events')}
                              </p>
                            ) : (
                              <div className='divide-y'>
                                {selectedEvents.events.map((event) => (
                                  <div
                                    key={event.id}
                                    className='flex flex-wrap items-center justify-between gap-2 py-2 text-xs'
                                  >
                                    <span className='font-medium'>
                                      {event.event_type}
                                    </span>
                                    <span className='text-muted-foreground'>
                                      {new Date(
                                        event.created_at * 1000
                                      ).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            ) : null}
          </section>

          <section className='space-y-3'>
            <div>
              <h2 className='text-lg font-semibold'>{t('Available plans')}</h2>
              <p className='text-muted-foreground text-sm'>
                {t('Plan price is sourced from the subscription plan record.')}
              </p>
            </div>
            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {plans.map((plan) => {
                const purchasable =
                  pricingStatus === 'published' && plan.purchase_enabled
                return (
                  <Card key={plan.plan_key} data-card-hover='false'>
                    <CardHeader>
                      <CardTitle>{plan.display_name}</CardTitle>
                      <p className='text-muted-foreground min-h-10 text-sm'>
                        {plan.description}
                      </p>
                    </CardHeader>
                    <CardContent className='space-y-4'>
                      <p className='text-2xl font-semibold tabular-nums'>
                        ${plan.price.toFixed(2)}{' '}
                        <span className='text-muted-foreground text-xs font-normal'>
                          {plan.currency}
                        </span>
                      </p>
                      <div className='text-muted-foreground space-y-1 text-xs'>
                        <p>
                          {t('Total Quota')}:{' '}
                          {plan.included_quota > 0
                            ? formatQuota(plan.included_quota)
                            : t('Unlimited')}
                        </p>
                        <p>
                          {t('Validity Period')}: {plan.duration_value}{' '}
                          {t(plan.billing_period)}
                        </p>
                        <p>
                          {t('Wallet overflow')}:{' '}
                          {plan.entitlements.allow_wallet_overflow
                            ? t('Enabled')
                            : t('Disabled')}
                        </p>
                      </div>
                      <Button
                        className='w-full'
                        disabled={!purchasable || busy !== null}
                        onClick={() =>
                          void run(
                            `buy-${plan.plan_key}`,
                            () =>
                              purchasePlatformSubscription(
                                plan.plan_key,
                                idempotencyKeyFor(`buy-${plan.plan_key}`)
                              ),
                            true
                          )
                        }
                      >
                        {purchasable
                          ? t('Purchase with Wallet')
                          : t('Purchase unavailable')}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>

          {historicalOnly.length > 0 ? (
            <section className='space-y-3'>
              <h2 className='text-lg font-semibold'>
                {t('Subscription history')}
              </h2>
              <Card data-card-hover='false'>
                <CardContent className='divide-y p-0'>
                  {historicalOnly.map((item) => (
                    <div
                      key={item.subscription.id}
                      className='flex flex-wrap items-center justify-between gap-3 p-4 text-sm'
                    >
                      <div>
                        <p className='font-medium'>
                          {item.lifecycle.name_en_snapshot}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          #{item.subscription.id} ·{' '}
                          {new Date(
                            item.subscription.start_time * 1000
                          ).toLocaleDateString()}{' '}
                          —{' '}
                          {new Date(
                            item.subscription.end_time * 1000
                          ).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant='outline'>
                        {stateLabel(item.lifecycle.lifecycle_state, t)}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
