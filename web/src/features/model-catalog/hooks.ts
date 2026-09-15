/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { listPlatformModels } from './api'
import type { PlatformModelSurface } from './types'

export const platformModelQueryKeys = {
  all: ['platform-models'] as const,
  list: (locale: string, surface: PlatformModelSurface) =>
    [...platformModelQueryKeys.all, locale, surface] as const,
  admin: ['platform-models-admin'] as const,
}

export function usePlatformModels(surface: PlatformModelSurface = 'models') {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return useQuery({
    queryKey: platformModelQueryKeys.list(locale, surface),
    queryFn: () => listPlatformModels(locale, surface),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

// This is the Phase 5A Playground seam: it exposes only catalog entries that
// the backend marked for Playground. The existing chat UI remains unchanged.
export function usePlaygroundPlatformModels() {
  return usePlatformModels('playground')
}
