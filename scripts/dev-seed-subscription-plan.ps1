param(
  [string]$BaseUrl = "http://localhost:3001",
  [string]$AdminAccessToken = $env:DEV_ADMIN_ACCESS_TOKEN
)

$ErrorActionPreference = "Stop"

if ($env:APP_ENV -eq "production" -or $env:GIN_MODE -eq "release") {
  throw "The Phase 5C preview seed is disabled in production/release environments."
}
if ([string]::IsNullOrWhiteSpace($AdminAccessToken)) {
  throw "Set DEV_ADMIN_ACCESS_TOKEN or pass -AdminAccessToken. Secrets are never stored by this script."
}

$headers = @{ Authorization = "Bearer $AdminAccessToken" }
$existing = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/platform/admin/subscriptions/plans" -Headers $headers
if ($existing.data.plans.profile.plan_key -contains "developer-preview") {
  Write-Host "developer-preview already exists; preserving operator edits."
  exit 0
}

$payload = @{
  profile = @{
    plan_key = "developer-preview"
    name_zh = "开发者预览套餐"
    name_en = "Developer Preview"
    description_zh = "仅用于本地订阅生命周期验收。"
    description_en = "Local-only subscription lifecycle acceptance plan."
    visibility = "internal"
    purchase_enabled = $false
    renewal_enabled = $false
    lifecycle_state = "draft"
  }
  plan = @{
    title = "Developer Preview"
    subtitle = "Local acceptance only"
    price_amount = 0
    currency = "USD"
    duration_unit = "month"
    duration_value = 1
    enabled = $false
    sort_order = 0
    allow_balance_pay = $true
    allow_wallet_overflow = $true
    max_purchase_per_user = 0
    total_amount = 100000
    quota_reset_period = "monthly"
  }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/platform/admin/subscriptions/plans" -Headers $headers -ContentType "application/json" -Body $payload | Out-Null
Write-Host "Created internal developer-preview plan with purchase and renewal disabled."
