/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { api } from '@/lib/api'

import type {
  PlatformModel,
  PlatformModelAdmin,
  PlatformModelResponse,
  PlatformModelSurface,
} from './types'

export async function listPlatformModels(
  locale: string,
  surface: PlatformModelSurface = 'models'
): Promise<PlatformModel[]> {
  const response = await api.get<PlatformModelResponse>(
    '/api/platform/models',
    { params: { locale, surface } }
  )
  if (!response.data.success) throw new Error(response.data.message)
  // A successful envelope can still carry a null payload (an empty catalogue,
  // or a generic success stub). Normalise here rather than at each call site:
  // `const { data = [] } = useQuery(...)` only defaults on `undefined`, so a
  // null would otherwise reach `.map` and take the whole page down.
  return response.data.data ?? []
}

export async function listAdminPlatformModels(params?: {
  search?: string
  status?: string
}): Promise<PlatformModelAdmin[]> {
  const response = await api.get('/api/platform/admin/models', { params })
  if (!response.data.success) throw new Error(response.data.message)
  return response.data.data
}

export type PlatformModelAdminInput = Omit<
  PlatformModelAdmin,
  'id' | 'created_at' | 'updated_at' | 'diagnostic'
>

export async function createPlatformModel(
  input: PlatformModelAdminInput
): Promise<PlatformModelAdmin> {
  const response = await api.post('/api/platform/admin/models', input)
  if (!response.data.success) throw new Error(response.data.message)
  return response.data.data
}

export async function updatePlatformModel(
  id: number,
  input: PlatformModelAdminInput
): Promise<PlatformModelAdmin> {
  const response = await api.put(`/api/platform/admin/models/${id}`, input)
  if (!response.data.success) throw new Error(response.data.message)
  return response.data.data
}

export async function setPlatformModelAPIEnabled(
  id: number,
  apiEnabled: boolean
): Promise<void> {
  const response = await api.patch(
    `/api/platform/admin/models/${id}/api-enabled`,
    { api_enabled: apiEnabled }
  )
  if (!response.data.success) throw new Error(response.data.message)
}

export async function archivePlatformModel(id: number): Promise<void> {
  const response = await api.delete(`/api/platform/admin/models/${id}`)
  if (!response.data.success) throw new Error(response.data.message)
}
