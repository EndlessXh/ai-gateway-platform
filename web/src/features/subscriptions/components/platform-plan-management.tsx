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
import { Archive, Plus, RefreshCw, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatQuota } from '@/lib/format'

import {
  adminCancelPlatformSubscription,
  adminRenewPlatformSubscription,
  archivePlatformPlan,
  createPlatformPlan,
  getAdminPlatformPlans,
  getAdminPlatformSubscription,
  getAdminPlatformSubscriptions,
  reconcilePlatformSubscriptions,
  updatePlatformPlan,
} from '../api'
import type {
  PlatformPlanRecord,
  PlatformSubscriptionEvent,
  PlatformSubscriptionRecord,
} from '../types'

type Draft = {
  key: string
  nameEn: string
  nameZh: string
  price: string
  quota: string
}

type PlanEdit = {
  price: string
  quota: string
  group: string
}

const emptyDraft: Draft = {
  key: '',
  nameEn: '',
  nameZh: '',
  price: '0',
  quota: '0',
}

export function PlatformPlanManagement() {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<PlatformPlanRecord[]>([])
  const [subscriptions, setSubscriptions] = useState<
    PlatformSubscriptionRecord[]
  >([])
  const [pricingStatus, setPricingStatus] = useState('provisional')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const idempotencyKeys = useRef(new Map<string, string>())
  const [showCreate, setShowCreate] = useState(false)
  const [editingPlan, setEditingPlan] = useState<number | null>(null)
  const [planEdit, setPlanEdit] = useState<PlanEdit>({
    price: '0',
    quota: '0',
    group: '',
  })
  const [selectedEvents, setSelectedEvents] = useState<{
    subscriptionId: number
    events: PlatformSubscriptionEvent[]
  } | null>(null)

  const refresh = useCallback(async () => {
    const [planResponse, subscriptionResponse] = await Promise.all([
      getAdminPlatformPlans(),
      getAdminPlatformSubscriptions(),
    ])
    setPlans(planResponse.data?.plans || [])
    setPricingStatus(planResponse.data?.pricing_status || 'provisional')
    setSubscriptions(subscriptionResponse.data || [])
  }, [])

  useEffect(() => {
    refresh().catch(() => toast.error(t('Request failed')))
  }, [refresh, t])

  const idempotencyKeyFor = (operation: string) => {
    const existing = idempotencyKeys.current.get(operation)
    if (existing) return existing
    const created = crypto.randomUUID()
    idempotencyKeys.current.set(operation, created)
    return created
  }

  const run = async (
    action: () => Promise<unknown>,
    idempotencyOperation?: string
  ) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action()
      await refresh()
      if (idempotencyOperation) {
        idempotencyKeys.current.delete(idempotencyOperation)
      }
      toast.success(t('Updated successfully'))
    } catch {
      toast.error(t('Request failed'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const inspect = async (subscriptionId: number) => {
    setBusy(true)
    try {
      const response = await getAdminPlatformSubscription(subscriptionId)
      if (!response.success || !response.data) {
        throw new Error(response.message)
      }
      setSelectedEvents({
        subscriptionId,
        events: response.data.events || [],
      })
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      const response = await createPlatformPlan({
        profile: {
          plan_key: draft.key,
          name_en: draft.nameEn,
          name_zh: draft.nameZh,
          description_en: '',
          description_zh: '',
          visibility: 'internal',
          lifecycle_state: 'draft',
          purchase_enabled: false,
          renewal_enabled: false,
        },
        plan: {
          title: draft.nameEn,
          subtitle: '',
          price_amount: Number(draft.price),
          currency: 'USD',
          duration_unit: 'month',
          duration_value: 1,
          quota_reset_period: 'monthly',
          enabled: false,
          sort_order: 0,
          allow_balance_pay: true,
          allow_wallet_overflow: true,
          max_purchase_per_user: 0,
          total_amount: Number(draft.quota),
        },
      })
      if (!response.success) throw new Error(response.message)
      setDraft(emptyDraft)
      setShowCreate(false)
    })

  const update = (
    record: PlatformPlanRecord,
    profilePatch: Partial<PlatformPlanRecord['profile']>
  ) =>
    run(async () => {
      const response = await updatePlatformPlan({
        ...record,
        profile: { ...record.profile, ...profilePatch },
      })
      if (!response.success) throw new Error(response.message)
    })

  const beginPlanEdit = (record: PlatformPlanRecord) => {
    setEditingPlan(record.profile.id)
    setPlanEdit({
      price: String(record.plan.price_amount),
      quota: String(record.plan.total_amount),
      group: record.plan.upgrade_group || '',
    })
  }

  const savePlanEdit = (record: PlatformPlanRecord) =>
    run(async () => {
      await updatePlatformPlan({
        ...record,
        plan: {
          ...record.plan,
          price_amount: Number(planEdit.price),
          total_amount: Number(planEdit.quota),
          upgrade_group: planEdit.group.trim(),
        },
      })
      setEditingPlan(null)
    })

  return (
    <div className='space-y-4'>
      <Card data-card-hover='false'>
        <CardHeader className='border-b'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <CardTitle>{t('Product subscription plans')}</CardTitle>
              <p className='text-muted-foreground mt-1 text-sm'>
                {t(
                  'Product metadata extends the upstream billing plan; price and quota remain upstream-owned.'
                )}
              </p>
            </div>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setShowCreate((value) => !value)}
            >
              <Plus /> {t('Create plan')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-4 pt-5'>
          {pricingStatus !== 'published' ? (
            <Alert>
              <ShieldAlert />
              <AlertDescription>
                {t(
                  'Pricing is provisional. User purchase and renewal APIs are release-guarded.'
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {showCreate ? (
            <div className='bg-muted/30 grid gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-5'>
              {[
                ['key', t('Plan key')],
                ['nameEn', t('English name')],
                ['nameZh', t('Chinese name')],
                ['price', t('Price (USD)')],
                ['quota', t('Quota')],
              ].map(([field, label]) => (
                <div key={field} className='space-y-1.5'>
                  <Label htmlFor={`plan-${field}`}>{label}</Label>
                  <Input
                    id={`plan-${field}`}
                    value={draft[field as keyof Draft]}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              <div className='flex items-end sm:col-span-2 xl:col-span-5'>
                <Button
                  size='sm'
                  onClick={() => void create()}
                  disabled={
                    busy || !draft.key || !draft.nameEn || !draft.nameZh
                  }
                >
                  {t('Create disabled draft')}
                </Button>
              </div>
            </div>
          ) : null}

          {plans.length === 0 ? (
            <p className='text-muted-foreground py-5 text-center text-sm'>
              {t('No product subscription plans')}
            </p>
          ) : (
            <div className='divide-y rounded-xl border'>
              {plans.map((record) => (
                <div
                  key={record.profile.id}
                  className='grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center'
                >
                  <div className='min-w-0 space-y-3'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <p className='font-medium'>{record.profile.name_en}</p>
                      <Badge variant='outline'>
                        {record.profile.lifecycle_state}
                      </Badge>
                      <Badge variant='secondary'>
                        {record.profile.visibility}
                      </Badge>
                    </div>
                    <p className='text-muted-foreground mt-1 font-mono text-xs'>
                      {record.profile.plan_key} · upstream #{record.plan.id} · v
                      {record.profile.version}
                    </p>
                    <p className='text-muted-foreground mt-2 text-xs'>
                      ${record.plan.price_amount.toFixed(2)}{' '}
                      {record.plan.currency} · {t('Quota')}{' '}
                      {formatQuota(record.plan.total_amount)}
                    </p>
                    {editingPlan === record.profile.id ? (
                      <div className='grid max-w-2xl gap-3 sm:grid-cols-3'>
                        <div className='space-y-1.5'>
                          <Label htmlFor={`edit-price-${record.profile.id}`}>
                            {t('Price (USD)')}
                          </Label>
                          <Input
                            id={`edit-price-${record.profile.id}`}
                            type='number'
                            min='0'
                            step='0.01'
                            value={planEdit.price}
                            onChange={(event) =>
                              setPlanEdit((value) => ({
                                ...value,
                                price: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className='space-y-1.5'>
                          <Label htmlFor={`edit-quota-${record.profile.id}`}>
                            {t('Quota')}
                          </Label>
                          <Input
                            id={`edit-quota-${record.profile.id}`}
                            type='number'
                            min='0'
                            step='1'
                            value={planEdit.quota}
                            onChange={(event) =>
                              setPlanEdit((value) => ({
                                ...value,
                                quota: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className='space-y-1.5'>
                          <Label htmlFor={`edit-group-${record.profile.id}`}>
                            {t('User group')}
                          </Label>
                          <Input
                            id={`edit-group-${record.profile.id}`}
                            value={planEdit.group}
                            onChange={(event) =>
                              setPlanEdit((value) => ({
                                ...value,
                                group: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className='flex flex-wrap items-center gap-4'>
                    {editingPlan === record.profile.id ? (
                      <Button
                        size='sm'
                        disabled={
                          busy ||
                          !Number.isFinite(Number(planEdit.price)) ||
                          Number(planEdit.price) < 0 ||
                          !Number.isSafeInteger(Number(planEdit.quota)) ||
                          Number(planEdit.quota) < 0
                        }
                        onClick={() => void savePlanEdit(record)}
                      >
                        {t('Save')}
                      </Button>
                    ) : (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={
                          busy || record.profile.lifecycle_state === 'archived'
                        }
                        onClick={() => beginPlanEdit(record)}
                      >
                        {t('Edit')}
                      </Button>
                    )}
                    <Label className='flex items-center gap-2 text-xs'>
                      <Switch
                        checked={record.profile.purchase_enabled}
                        disabled={
                          busy || record.profile.lifecycle_state === 'archived'
                        }
                        onCheckedChange={(checked) =>
                          void update(record, { purchase_enabled: checked })
                        }
                      />
                      {t('Purchasable')}
                    </Label>
                    <Label className='flex items-center gap-2 text-xs'>
                      <Switch
                        checked={record.profile.renewal_enabled}
                        disabled={
                          busy || record.profile.lifecycle_state === 'archived'
                        }
                        onCheckedChange={(checked) =>
                          void update(record, { renewal_enabled: checked })
                        }
                      />
                      {t('Renewable')}
                    </Label>
                    {record.profile.lifecycle_state === 'draft' ? (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() =>
                          void update(record, {
                            lifecycle_state: 'active',
                            visibility: 'public',
                          })
                        }
                      >
                        {t('Activate')}
                      </Button>
                    ) : null}
                    {record.profile.lifecycle_state !== 'archived' ? (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                'Archive this plan? Existing subscriptions and financial history are retained.'
                              )
                            )
                          ) {
                            void run(() =>
                              archivePlatformPlan(record.profile.id)
                            )
                          }
                        }}
                      >
                        <Archive /> {t('Archive')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-card-hover='false'>
        <CardHeader className='border-b'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <CardTitle>{t('Lifecycle diagnostics')}</CardTitle>
              <p className='text-muted-foreground mt-1 text-sm'>
                {t('Recent product subscriptions and entitlement truth.')}
              </p>
            </div>
            <Button
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={() => void run(reconcilePlatformSubscriptions)}
            >
              <RefreshCw className={busy ? 'animate-spin' : ''} />
              {t('Reconcile')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className='pt-5'>
          {subscriptions.length === 0 ? (
            <p className='text-muted-foreground py-4 text-center text-sm'>
              {t('No product lifecycle records')}
            </p>
          ) : (
            <div className='divide-y rounded-xl border'>
              {subscriptions.map((item) => (
                <div
                  key={item.subscription.id}
                  className='flex flex-wrap items-center justify-between gap-3 p-3 text-sm'
                >
                  <div>
                    <p className='font-medium'>
                      {item.lifecycle.name_en_snapshot} · user #
                      {item.subscription.user_id}
                    </p>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      subscription #{item.subscription.id} · order #
                      {item.lifecycle.latest_order_id || '—'} · ends{' '}
                      {new Date(
                        item.subscription.end_time * 1000
                      ).toLocaleString()}
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    {item.lifecycle.auto_renew ? (
                      <Badge variant='secondary'>{t('Auto-renew')}</Badge>
                    ) : null}
                    <Badge variant='outline'>
                      {item.lifecycle.lifecycle_state}
                    </Badge>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={busy}
                      onClick={() => void inspect(item.subscription.id)}
                    >
                      {t('Events')}
                    </Button>
                    {item.lifecycle.lifecycle_state === 'active' ? (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            adminCancelPlatformSubscription(
                              item.subscription.id,
                              false
                            )
                          )
                        }
                      >
                        {t('Cancel at period end')}
                      </Button>
                    ) : null}
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy || pricingStatus !== 'published'}
                      onClick={() =>
                        void run(
                          () =>
                            adminRenewPlatformSubscription(
                              item.subscription.id,
                              idempotencyKeyFor(
                                `admin-renew-${item.subscription.id}`
                              )
                            ),
                          `admin-renew-${item.subscription.id}`
                        )
                      }
                    >
                      {t('Renew')}
                    </Button>
                    {item.lifecycle.lifecycle_state !== 'canceled' &&
                    item.lifecycle.lifecycle_state !== 'expired' ? (
                      <Button
                        size='sm'
                        variant='destructive'
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(
                            t('Reason for immediate termination')
                          )
                          if (reason?.trim()) {
                            void run(() =>
                              adminCancelPlatformSubscription(
                                item.subscription.id,
                                true,
                                reason.trim()
                              )
                            )
                          }
                        }}
                      >
                        {t('Terminate')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {selectedEvents ? (
            <div className='mt-4 rounded-xl border p-4'>
              <div className='mb-3 flex items-center justify-between gap-3'>
                <p className='font-medium'>
                  {t('Subscription events')} #{selectedEvents.subscriptionId}
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
                <p className='text-muted-foreground text-sm'>
                  {t('No subscription events')}
                </p>
              ) : (
                <div className='space-y-2'>
                  {selectedEvents.events.map((event) => (
                    <div
                      key={event.id}
                      className='bg-muted/40 flex flex-wrap justify-between gap-2 rounded-lg p-3 text-xs'
                    >
                      <span className='font-medium'>{event.event_type}</span>
                      <span className='text-muted-foreground'>
                        {event.actor_type} ·{' '}
                        {new Date(event.created_at * 1000).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
