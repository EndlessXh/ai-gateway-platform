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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  PlanRecord,
  PlanPayload,
  UserSubscriptionRecord,
  CreateUserSubscriptionRequest,
  ResetUserSubscriptionsRequest,
  ResetPlanSubscriptionsRequest,
  SubscriptionResetResult,
  SubscriptionPayResponse,
  SubscriptionPayRequest,
  SelfSubscriptionData,
  SubscriptionPlan,
  PlatformPlanRecord,
  PlatformPublicPlan,
  PlatformSubscriptionRecord,
  PlatformSubscriptionEvent,
} from './types'

function requirePlatformSuccess<T>(response: ApiResponse<T>): ApiResponse<T> {
  if (!response.success) {
    throw new Error(response.message || 'Subscription operation failed')
  }
  return response
}

export async function getPlatformPlans(
  locale?: string
): Promise<
  ApiResponse<{ pricing_status: string; plans: PlatformPublicPlan[] }>
> {
  const res = await api.get('/api/platform/plans', {
    headers: locale ? { 'Accept-Language': locale } : undefined,
  })
  return requirePlatformSuccess(res.data)
}

export async function getCurrentPlatformSubscriptions(): Promise<
  ApiResponse<{
    pricing_status: string
    subscriptions: PlatformSubscriptionRecord[]
  }>
> {
  const res = await api.get('/api/platform/subscriptions/current')
  return requirePlatformSuccess(res.data)
}

export async function getPlatformSubscriptionHistory(): Promise<
  ApiResponse<{ subscriptions: PlatformSubscriptionRecord[] }>
> {
  const res = await api.get('/api/platform/subscriptions/history')
  return requirePlatformSuccess(res.data)
}

export async function getPlatformSubscriptionEvents(
  subscriptionId: number
): Promise<ApiResponse<PlatformSubscriptionEvent[]>> {
  const res = await api.get(
    `/api/platform/subscriptions/${subscriptionId}/events`
  )
  return requirePlatformSuccess(res.data)
}

export async function purchasePlatformSubscription(
  planKey: string,
  idempotencyKey: string
) {
  const res = await api.post(
    '/api/platform/subscriptions/purchase',
    { plan_key: planKey },
    { headers: { 'Idempotency-Key': idempotencyKey } }
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<PlatformSubscriptionRecord>
  )
}

export async function cancelPlatformSubscription(subscriptionId: number) {
  const res = await api.post(
    `/api/platform/subscriptions/${subscriptionId}/cancel`
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<PlatformSubscriptionRecord>
  )
}

export async function revokePlatformSubscriptionCancellation(
  subscriptionId: number
) {
  const res = await api.post(
    `/api/platform/subscriptions/${subscriptionId}/cancel/revoke`
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<PlatformSubscriptionRecord>
  )
}

export async function renewPlatformSubscription(
  subscriptionId: number,
  idempotencyKey: string
) {
  const res = await api.post(
    `/api/platform/subscriptions/${subscriptionId}/renew`,
    {},
    { headers: { 'Idempotency-Key': idempotencyKey } }
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<PlatformSubscriptionRecord>
  )
}

export async function setPlatformSubscriptionAutoRenew(
  subscriptionId: number,
  enabled: boolean
) {
  const res = await api.put(
    `/api/platform/subscriptions/${subscriptionId}/auto-renew`,
    { enabled }
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<PlatformSubscriptionRecord>
  )
}

export async function getAdminPlatformPlans(): Promise<
  ApiResponse<{ pricing_status: string; plans: PlatformPlanRecord[] }>
> {
  const res = await api.get('/api/platform/admin/subscriptions/plans')
  return requirePlatformSuccess(res.data)
}

export async function createPlatformPlan(data: {
  profile: Partial<PlatformPlanRecord['profile']>
  plan: Partial<SubscriptionPlan>
}) {
  const res = await api.post('/api/platform/admin/subscriptions/plans', data)
  return requirePlatformSuccess(res.data as ApiResponse<PlatformPlanRecord>)
}

export async function updatePlatformPlan(record: PlatformPlanRecord) {
  const res = await api.put(
    `/api/platform/admin/subscriptions/plans/${record.profile.id}`,
    record
  )
  return requirePlatformSuccess(res.data as ApiResponse<PlatformPlanRecord>)
}

export async function archivePlatformPlan(id: number) {
  const res = await api.delete(`/api/platform/admin/subscriptions/plans/${id}`)
  return requirePlatformSuccess(res.data as ApiResponse)
}

export async function getAdminPlatformSubscriptions(): Promise<
  ApiResponse<PlatformSubscriptionRecord[]>
> {
  const res = await api.get('/api/platform/admin/subscriptions', {
    params: { limit: 100 },
  })
  return requirePlatformSuccess(res.data)
}

export async function getAdminPlatformSubscription(subscriptionId: number) {
  const res = await api.get(
    `/api/platform/admin/subscriptions/${subscriptionId}`
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<{
      subscription: PlatformSubscriptionRecord
      events: PlatformSubscriptionEvent[]
    }>
  )
}

export async function adminCancelPlatformSubscription(
  subscriptionId: number,
  immediate: boolean,
  reason = ''
) {
  const res = await api.post(
    `/api/platform/admin/subscriptions/${subscriptionId}/cancel`,
    { immediate, reason }
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<PlatformSubscriptionRecord>
  )
}

export async function adminRenewPlatformSubscription(
  subscriptionId: number,
  idempotencyKey: string
) {
  const res = await api.post(
    `/api/platform/admin/subscriptions/${subscriptionId}/renew`,
    {},
    { headers: { 'Idempotency-Key': idempotencyKey } }
  )
  return requirePlatformSuccess(
    res.data as ApiResponse<PlatformSubscriptionRecord>
  )
}

export async function reconcilePlatformSubscriptions() {
  const res = await api.post('/api/platform/admin/subscriptions/reconcile')
  return requirePlatformSuccess(
    res.data as ApiResponse<{
      renewal_attempts: number
      reconciled: number
    }>
  )
}

// ============================================================================
// Admin Plan Management
// ============================================================================

export async function getAdminPlans(): Promise<ApiResponse<PlanRecord[]>> {
  const res = await api.get('/api/subscription/admin/plans')
  return res.data
}

export async function createPlan(
  data: PlanPayload
): Promise<ApiResponse<PlanRecord>> {
  const res = await api.post('/api/subscription/admin/plans', data)
  return res.data
}

export async function updatePlan(
  id: number,
  data: PlanPayload
): Promise<ApiResponse<PlanRecord>> {
  const res = await api.put(`/api/subscription/admin/plans/${id}`, data)
  return res.data
}

export async function patchPlanStatus(
  id: number,
  enabled: boolean
): Promise<ApiResponse> {
  const res = await api.patch(`/api/subscription/admin/plans/${id}`, {
    enabled,
  })
  return res.data
}

// ============================================================================
// Admin User Subscription Management
// ============================================================================

export async function getUserSubscriptions(
  userId: number
): Promise<ApiResponse<UserSubscriptionRecord[]>> {
  const res = await api.get(
    `/api/subscription/admin/users/${userId}/subscriptions`
  )
  return res.data
}

export async function createUserSubscription(
  userId: number,
  data: CreateUserSubscriptionRequest
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post(
    `/api/subscription/admin/users/${userId}/subscriptions`,
    data
  )
  return res.data
}

export async function invalidateUserSubscription(
  subId: number
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post(
    `/api/subscription/admin/user_subscriptions/${subId}/invalidate`
  )
  return res.data
}

export async function deleteUserSubscription(
  subId: number
): Promise<ApiResponse> {
  const res = await api.delete(
    `/api/subscription/admin/user_subscriptions/${subId}`
  )
  return res.data
}

export async function resetUserSubscriptionsByPlan(
  userId: number,
  data: ResetUserSubscriptionsRequest
): Promise<ApiResponse<SubscriptionResetResult>> {
  const res = await api.post(
    `/api/subscription/admin/users/${userId}/subscriptions/reset`,
    data
  )
  return res.data
}

export async function resetPlanSubscriptions(
  planId: number,
  data: ResetPlanSubscriptionsRequest
): Promise<ApiResponse<SubscriptionResetResult>> {
  const res = await api.post(
    `/api/subscription/admin/plans/${planId}/subscriptions/reset`,
    data
  )
  return res.data
}

// ============================================================================
// User-facing Subscription Payment
// ============================================================================

export async function paySubscriptionStripe(
  data: SubscriptionPayRequest
): Promise<SubscriptionPayResponse> {
  const res = await api.post('/api/subscription/stripe/pay', data)
  return res.data
}

export async function paySubscriptionCreem(
  data: SubscriptionPayRequest
): Promise<SubscriptionPayResponse> {
  const res = await api.post('/api/subscription/creem/pay', data)
  return res.data
}

export async function paySubscriptionWaffoPancake(
  data: SubscriptionPayRequest
): Promise<SubscriptionPayResponse> {
  const res = await api.post('/api/subscription/waffo-pancake/pay', data)
  return res.data
}

export async function paySubscriptionBalance(
  data: SubscriptionPayRequest
): Promise<SubscriptionPayResponse> {
  const res = await api.post('/api/subscription/balance/pay', data)
  return res.data
}

// Mints a Pancake OnetimeProduct (see controller for the OnetimeProduct vs
// SubscriptionProduct rationale) using persisted creds + StoreID.
export async function createWaffoPancakeSubscriptionProduct(data: {
  name: string
  amount: string
}): Promise<
  ApiResponse<{ product_id: string; product_name: string; store_id: string }>
> {
  const res = await api.post(
    '/api/option/waffo-pancake/subscription-product',
    data
  )
  return res.data
}

// Returns the OnetimeProducts in the saved Pancake store; empty when the
// gateway isn't fully configured.
export async function listWaffoPancakeSubscriptionProductOptions(): Promise<
  ApiResponse<{
    store_id: string
    products: { id: string; name: string; status: string }[]
  }>
> {
  const res = await api.get(
    '/api/option/waffo-pancake/subscription-product-options'
  )
  return res.data
}

export async function paySubscriptionEpay(
  data: SubscriptionPayRequest & { payment_method: string }
): Promise<SubscriptionPayResponse & { url?: string }> {
  const res = await api.post('/api/subscription/epay/pay', data)
  return {
    ...res.data,
    url: res.data.url || (res as unknown as { url?: string }).url,
  }
}

// ============================================================================
// User Self Subscriptions
// ============================================================================

export async function getSelfSubscriptions(): Promise<
  ApiResponse<UserSubscriptionRecord[]>
> {
  const res = await api.get('/api/subscription/self')
  return res.data
}

export async function getSelfSubscriptionFull(): Promise<
  ApiResponse<SelfSubscriptionData>
> {
  const res = await api.get('/api/subscription/self')
  return res.data
}

export async function getPublicPlans(): Promise<ApiResponse<PlanRecord[]>> {
  const res = await api.get('/api/subscription/plans')
  return res.data
}

export async function updateBillingPreference(
  preference: string
): Promise<ApiResponse<{ billing_preference?: string }>> {
  const res = await api.put('/api/subscription/self/preference', {
    billing_preference: preference,
  })
  return res.data
}

export async function getGroups(): Promise<ApiResponse<string[]>> {
  const res = await api.get('/api/group')
  return res.data
}
