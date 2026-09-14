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
import { cn } from '@/lib/utils'

import { ErrorPage } from './error-page'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
  error?: unknown
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as Record<string, unknown>).response
  if (typeof response !== 'object' || response === null) return undefined
  const status = (response as Record<string, unknown>).status
  return typeof status === 'number' ? status : undefined
}

export function GeneralError(props: GeneralErrorProps) {
  const status = getHttpStatus(props.error)
  const isRateLimited = status === 429

  if (props.minimal) {
    return (
      <div className={cn('text-muted-foreground p-6 text-sm', props.className)}>
        {isRateLimited
          ? 'Too many requests. Please wait before trying again.'
          : 'The page could not be loaded. Please try again.'}
      </div>
    )
  }

  return (
    <ErrorPage
      code={String(status ?? 500)}
      eyebrow={isRateLimited ? 'Request limit reached' : 'Application error'}
      title={
        isRateLimited
          ? 'Too many requests were sent.'
          : 'The page could not be loaded.'
      }
      description={
        isRateLimited
          ? 'Wait a moment before retrying so the gateway can accept the request.'
          : 'Retry the page. If the problem continues, return home or consult the documentation.'
      }
      onRetry={() => window.location.reload()}
    />
  )
}
