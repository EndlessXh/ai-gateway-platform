/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/

export type CatalogAvailability =
  | 'available'
  | 'preview'
  | 'maintenance'
  | 'coming_soon'
  | 'disabled'

export type CatalogPricing = {
  status: 'configured'
  quota_type: number
  model_ratio: number
  completion_ratio: number
  model_price: number
  cache_ratio?: number
  create_cache_ratio?: number
  image_ratio?: number
  audio_ratio?: number
  audio_completion_ratio?: number
}

export type PromptCacheInfo = {
  minimum_tokens: number
  source: 'anthropic-docs' | 'measurement'
  checked_at: string
}

export type PlatformModel = {
  public_model_id: string
  display_name: string
  provider_key: string
  provider_label: string
  description: string
  category: string
  capabilities: string[]
  input_modalities: string[]
  output_modalities: string[]
  context_label: string
  /** Zero means the upstream did not provide a context window. */
  context_tokens: number
  icon_key: string
  badge: string
  availability_status: CatalogAvailability
  recommended: boolean
  api_enabled: boolean
  prompt_cache?: PromptCacheInfo
  pricing: CatalogPricing | null
  pricing_status: 'configured' | 'unavailable'
  route_availability:
    | 'available'
    | 'no_active_route'
    | 'not_accessible'
    | 'api_disabled'
  sort_order: number
}

export type PlatformModelResponse = {
  success: boolean
  message: string
  data: PlatformModel[]
}

export type PlatformModelSurface = 'models' | 'pricing' | 'playground'

export type PlatformModelAdmin = {
  id: number
  public_model_id: string
  display_name: string
  provider_key: string
  provider_label: string
  description_en: string
  description_zh_cn: string
  category: string
  capabilities: string[]
  input_modalities: string[]
  output_modalities: string[]
  context_label: string
  icon_key: string
  badge_key: string
  availability_status: CatalogAvailability
  visibility: 'public' | 'hidden'
  show_in_pricing: boolean
  show_in_playground: boolean
  api_enabled: boolean
  recommended: boolean
  sort_order: number
  created_at: number
  updated_at: number
  diagnostic: {
    route_status: PlatformModel['route_availability']
    pricing_status: 'configured' | 'unavailable'
    active_route_count: number
    accessible_route_count: number
    issues: string[]
  }
}
