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
import { PublicLayout } from '@/components/layout'

import { ErrorPage } from './error-page'

export function NotFoundError() {
  return (
    <PublicLayout showMainContainer={false}>
      <ErrorPage
        code='404'
        eyebrow='Route not found'
        title='This page is not part of the gateway.'
        description='The address may be outdated or the page may have moved. Use a known route to continue.'
        embedded
        showConsole
        showSignIn
      />
    </PublicLayout>
  )
}
