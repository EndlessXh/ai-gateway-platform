import { complianceFallback, type ComplianceStatus } from '@/config/brand'

import { useStatus } from './use-status'

type CompliancePayload = {
  source_code_url?: string
  license_notice_url?: string
  upstream_project_name?: string
  upstream_project_url?: string
  attribution_notice?: string
  license_name?: string
}

export function useCompliance(): ComplianceStatus {
  const { status } = useStatus()
  const raw = status?.compliance as CompliancePayload | undefined

  return {
    upstreamProjectName:
      raw?.upstream_project_name || complianceFallback.upstreamProjectName,
    upstreamProjectUrl:
      raw?.upstream_project_url || complianceFallback.upstreamProjectUrl,
    attributionNotice:
      raw?.attribution_notice || complianceFallback.attributionNotice,
    licenseName: raw?.license_name || complianceFallback.licenseName,
    sourceCodeUrl: raw?.source_code_url?.trim() || null,
    licenseNoticeUrl: raw?.license_notice_url?.trim() || null,
    pricingStatus:
      (status?.pricing_status as string | undefined)?.trim() || 'provisional',
  }
}
