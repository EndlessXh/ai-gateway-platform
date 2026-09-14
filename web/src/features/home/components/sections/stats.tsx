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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { usePlatformModels } from '@/features/model-catalog/hooks'

/*
  Metrics band.

  This section previously carried "50+ / 100+ / 50+ / 10+" copied from a
  reference site. Those were claims this deployment cannot substantiate, so
  every figure here is now derived from the live catalogue instead:

    - published models      -> catalogue length
    - upstream providers    -> distinct provider_label
    - request formats       -> the two shapes the gateway actually relays
    - routable models       -> route_availability === 'available'

  A number that cannot be derived is not shown. If the catalogue is empty the
  band renders zeros rather than inventing a floor.
*/
export function Stats() {
  const { t } = useTranslation()
  const { data = [], isLoading } = usePlatformModels()

  const metrics = useMemo(() => {
    const providers = new Set(
      data.map((model) => model.provider_label).filter(Boolean)
    )
    const routable = data.filter(
      (model) => model.route_availability === 'available'
    ).length

    return [
      { value: data.length, label: t('published models') },
      { value: providers.size, label: t('upstream providers') },
      { value: routable, label: t('models with a live route') },
      { value: 2, label: t('compatible request formats') },
    ]
  }, [data, t])

  return (
    <div className='border-border/40 bg-muted/10 relative z-10 border-y'>
      <div className='mx-auto max-w-6xl px-6 py-10 md:py-12'>
        <div className='grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-12'>
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className='flex flex-col items-center text-center'
            >
              {isLoading ? (
                <Skeleton className='h-12 w-20' />
              ) : (
                <span className='data-value text-2xl leading-none font-bold tracking-tight md:text-3xl'>
                  {metric.value}
                </span>
              )}
              <span className='text-muted-foreground mt-1.5 text-xs'>
                {metric.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
