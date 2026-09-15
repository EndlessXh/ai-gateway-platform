export const brandConfig = Object.freeze({
  name: 'HYC AI',
  shortName: 'HYC',
  description:
    'A unified AI API gateway for model routing, access control, usage logs, and quota visibility.',
  logo: '/hyc-mark.svg',
  favicon: '/hyc-mark.svg',
  docsUrl: '/about',
  supportUrl: '/about',
  apiBaseUrl: '/v1',
  apiKeyEnvName: 'HYC_API_KEY',
  social: Object.freeze({
    title: 'HYC AI — unified AI API gateway',
    description:
      'Route compatible AI API traffic through one controlled gateway.',
    image: '/hyc-mark.svg',
  }),
  copyright: 'All rights reserved.',
  sourceCodeUrl: null,
  legalNoticeUrl: '/about',
})

const upstreamBrandDefaults = new Set(['New API', 'NewAPI'])

export function resolveProductName(runtimeName?: string | null): string {
  const candidate = runtimeName?.trim()
  return candidate && !upstreamBrandDefaults.has(candidate)
    ? candidate
    : brandConfig.name
}

export function resolveProductLogo(runtimeLogo?: string | null): string {
  const candidate = runtimeLogo?.trim()
  return candidate && candidate !== '/logo.png' ? candidate : brandConfig.logo
}

// These legal identifiers are deliberately outside brand configuration.
// The API returns the authoritative values from setting/platform/compliance.go;
// these fixed fallbacks keep attribution visible during loading or an outage.
export const complianceFallback = Object.freeze({
  upstreamProjectName: 'New API',
  upstreamProjectUrl: 'https://github.com/QuantumNous/new-api',
  attributionNotice: 'Frontend design and development by New API contributors.',
  licenseName: 'AGPL-3.0',
})

export type ComplianceStatus = {
  upstreamProjectName: string
  upstreamProjectUrl: string
  attributionNotice: string
  licenseName: string
  sourceCodeUrl: string | null
  licenseNoticeUrl: string | null
  pricingStatus: string
}
