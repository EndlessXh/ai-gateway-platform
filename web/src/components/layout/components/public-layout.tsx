import { SkipToMain } from '@/components/skip-to-main'

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
import type { TopNavLink } from '../types'
import { Footer } from './footer'
import { PublicHeader, type PublicHeaderProps } from './public-header'

type PublicLayoutProps = {
  children: React.ReactNode
  showMainContainer?: boolean
  navContent?: React.ReactNode
  headerProps?: Omit<PublicHeaderProps, 'navContent'>
  navLinks?: TopNavLink[]
  showThemeSwitch?: boolean
  showAuthButtons?: boolean
  showNotifications?: boolean
  logo?: React.ReactNode
  siteName?: string
  showFooter?: boolean
}

export function PublicLayout(props: PublicLayoutProps) {
  // No `bg-background` on the wrapper on purpose: `body` already paints it,
  // and an opaque background here would occlude the negative-z ambient layer
  // below — which is exactly what happened before.
  return (
    <div className='text-foreground relative flex min-h-svh flex-col overflow-x-clip'>
      {/*
        Single ambient wash for the whole public shell rather than per-page
        gradients: every public route then shares one light field that fades
        out by mid-page, so long pages do not accumulate competing washes.
      */}
      <div aria-hidden='true' className='ambient-field' />
      <SkipToMain />
      <PublicHeader
        navContent={props.navContent}
        navLinks={props.navLinks}
        showThemeSwitch={props.showThemeSwitch}
        showAuthButtons={props.showAuthButtons}
        showNotifications={props.showNotifications}
        logo={props.logo}
        siteName={props.siteName}
        {...props.headerProps}
      />

      {props.showMainContainer !== false ? (
        <main id='content' className='container flex-1 px-4 py-6 pt-20 md:px-4'>
          {props.children}
        </main>
      ) : (
        <main id='content' className='flex-1'>
          {props.children}
        </main>
      )}
      {props.showFooter !== false ? <Footer /> : null}
    </div>
  )
}
