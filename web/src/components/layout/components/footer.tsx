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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  brandConfig,
  resolveProductLogo,
  resolveProductName,
} from '@/config/brand'
import { useCompliance } from '@/hooks/use-compliance'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

interface FooterProps {
  logo?: string
  name?: string
  copyright?: string
  className?: string
}

function FooterNavLink(props: { href: string; children: React.ReactNode }) {
  const className =
    'rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground'

  if (props.href.startsWith('http')) {
    return (
      <a
        href={props.href}
        target='_blank'
        rel='noopener noreferrer'
        className={className}
      >
        {props.children}
      </a>
    )
  }

  return (
    <Link to={props.href} className={className}>
      {props.children}
    </Link>
  )
}

export function Footer(props: FooterProps) {
  const { t } = useTranslation()
  const { systemName, logo, footerHtml } = useSystemConfig()
  const { status } = useStatus()
  const compliance = useCompliance()
  const currentYear = new Date().getFullYear()
  const displayName = props.name || resolveProductName(systemName)
  const displayLogo = props.logo || resolveProductLogo(logo)
  const configuredDocsUrl = (status?.docs_link as string | undefined)?.trim()
  const docsUrl =
    configuredDocsUrl === 'https://docs.newapi.pro'
      ? brandConfig.docsUrl
      : configuredDocsUrl || brandConfig.docsUrl

  return (
    <footer
      className={cn('border-border bg-surface border-t', props.className)}
    >
      <div className='page-container py-8 md:py-10'>
        <div className='grid gap-7 border-b pb-7 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]'>
          <div className='max-w-sm'>
            <Link
              to='/'
              className='inline-flex items-center gap-3 rounded-sm font-semibold tracking-tight'
            >
              <img
                src={displayLogo}
                alt={t('{{name}} logo', { name: displayName })}
                className='size-8 rounded-lg object-contain'
              />
              {displayName}
            </Link>
            <p className='text-muted-foreground mt-3 text-sm leading-6'>
              {t(brandConfig.description)}
            </p>
            {footerHtml ? (
              <div
                className='custom-footer text-muted-foreground mt-3 text-sm'
                dangerouslySetInnerHTML={{ __html: footerHtml }}
              />
            ) : null}
          </div>

          <nav
            aria-label={t('Footer navigation')}
            className='grid grid-cols-2 gap-x-8 gap-y-2.5 sm:grid-cols-3'
          >
            <FooterNavLink href={docsUrl}>{t('Documentation')}</FooterNavLink>
            <FooterNavLink href='/about'>{t('About')}</FooterNavLink>
            <FooterNavLink href='/privacy-policy'>
              {t('Privacy Policy')}
            </FooterNavLink>
            <FooterNavLink href='/user-agreement'>
              {t('User Agreement')}
            </FooterNavLink>
            <FooterNavLink href={brandConfig.legalNoticeUrl}>
              {t('Legal notice')}
            </FooterNavLink>
            {/*
              When SOURCE_CODE_URL is unset, render nothing rather than a
              placeholder. The AGPLv3 section 13 offer is enforced where it
              actually applies: deploy/compose.prod.yaml declares the variable
              as required and scripts/preflight-release.ps1 fails the release,
              so a production deployment always has a real link here. Showing
              "pending configuration" to visitors leaks internal deployment
              state and reads as a broken link while adding no compliance
              value. The attribution block below is unconditional.
            */}
            {compliance.sourceCodeUrl ? (
              <FooterNavLink href={compliance.sourceCodeUrl}>
                {t('Source code')}
              </FooterNavLink>
            ) : null}
          </nav>
        </div>

        <div className='flex flex-col gap-3 pt-5 text-xs sm:flex-row sm:items-start sm:justify-between'>
          <p className='text-muted-foreground'>
            © {currentYear} {displayName}.{' '}
            {props.copyright || t(brandConfig.copyright)}
          </p>
          {/*
            Attribution block. Every AGPL-required element is still here — the
            upstream project name, a live link to its repository, the §7(b)
            attribution notice and the licence link. What was removed is the
            second, identical link to the same repository: "Powered by" and
            "Original project:" pointed at the same URL, which made the block
            three lines taller without adding compliance value.
          */}
          <div className='text-muted-foreground max-w-2xl space-y-1 sm:text-right'>
            <p>
              {t('Powered by')}{' '}
              <a
                href={compliance.upstreamProjectUrl}
                target='_blank'
                rel='noopener noreferrer'
                className='text-foreground decoration-border hover:decoration-foreground underline underline-offset-4'
              >
                {compliance.upstreamProjectName}
              </a>{' '}
              ·{' '}
              <FooterNavLink
                href={compliance.licenseNoticeUrl || brandConfig.legalNoticeUrl}
              >
                {compliance.licenseName}
              </FooterNavLink>
            </p>
            <p>{compliance.attributionNotice}</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
