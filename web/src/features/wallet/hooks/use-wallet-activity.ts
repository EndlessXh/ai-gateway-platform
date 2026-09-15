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
import { useCallback, useEffect, useState } from 'react'

import {
  getRecentWalletConsumption,
  getUserBillingHistory,
  getWalletUsageSummary,
  isApiSuccess,
} from '../api'
import type { WalletActivityData } from '../types'

const emptyActivity: WalletActivityData = {
  today_usage: null,
  today_requests: null,
  recent_consumption: null,
  recent_topups: null,
  failed_sources: [],
}

export function useWalletActivity() {
  const [data, setData] = useState<WalletActivityData>(emptyActivity)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startTimestamp = Math.floor(start.getTime() / 1000)
    const [usage, summary, topups] = await Promise.allSettled([
      getRecentWalletConsumption(startTimestamp),
      getWalletUsageSummary(startTimestamp),
      getUserBillingHistory(1, 5),
    ])

    const failed: WalletActivityData['failed_sources'] = []
    let recentConsumption: WalletActivityData['recent_consumption'] = null
    let todayRequests: number | null = null
    let todayUsage: number | null = null
    let recentTopups: WalletActivityData['recent_topups'] = null

    if (
      usage.status === 'fulfilled' &&
      isApiSuccess(usage.value) &&
      usage.value.data
    ) {
      recentConsumption = usage.value.data.items ?? []
      todayRequests = usage.value.data.total ?? 0
    } else {
      failed.push('usage')
    }
    if (
      summary.status === 'fulfilled' &&
      isApiSuccess(summary.value) &&
      summary.value.data
    ) {
      todayUsage = summary.value.data.quota
    } else {
      failed.push('usage_summary')
    }
    if (
      topups.status === 'fulfilled' &&
      isApiSuccess(topups.value) &&
      topups.value.data
    ) {
      recentTopups = topups.value.data.items ?? []
    } else {
      failed.push('topups')
    }

    setData({
      today_usage: todayUsage,
      today_requests: todayRequests,
      recent_consumption: recentConsumption,
      recent_topups: recentTopups,
      failed_sources: failed,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return { data, loading, refresh }
}
