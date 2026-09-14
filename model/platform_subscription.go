package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	PlatformPlanStateDraft    = "draft"
	PlatformPlanStateActive   = "active"
	PlatformPlanStateArchived = "archived"

	PlatformSubscriptionStateActive        = "active"
	PlatformSubscriptionStatePending       = "pending"
	PlatformSubscriptionStateCanceling     = "canceling"
	PlatformSubscriptionStateCanceled      = "canceled"
	PlatformSubscriptionStateExpired       = "expired"
	PlatformSubscriptionStateFailed        = "failed"
	PlatformSubscriptionStateRenewalFailed = "renewal_failed"
)

// PlatformSubscriptionPlanProfile adds stable product metadata to the upstream
// subscription plan without duplicating its price, duration, or quota authority.
type PlatformSubscriptionPlanProfile struct {
	Id              int    `json:"id"`
	PlanId          int    `json:"plan_id" gorm:"not null;uniqueIndex"`
	PlanKey         string `json:"plan_key" gorm:"type:varchar(80);not null;uniqueIndex"`
	NameZh          string `json:"name_zh" gorm:"type:varchar(128);not null"`
	NameEn          string `json:"name_en" gorm:"type:varchar(128);not null"`
	DescriptionZh   string `json:"description_zh" gorm:"type:text"`
	DescriptionEn   string `json:"description_en" gorm:"type:text"`
	Visibility      string `json:"visibility" gorm:"type:varchar(16);not null;default:'private';index;check:chk_platform_plan_visibility,visibility IN ('public','private','internal')"`
	PurchaseEnabled bool   `json:"purchase_enabled" gorm:"not null"`
	RenewalEnabled  bool   `json:"renewal_enabled" gorm:"not null"`
	LifecycleState  string `json:"lifecycle_state" gorm:"type:varchar(16);not null;default:'draft';index;check:chk_platform_plan_state,lifecycle_state IN ('draft','active','archived')"`
	Version         int    `json:"version" gorm:"not null;default:1"`
	ArchivedAt      int64  `json:"archived_at" gorm:"type:bigint;not null;default:0"`
	CreatedAt       int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt       int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

func (PlatformSubscriptionPlanProfile) TableName() string {
	return "platform_subscription_plan_profiles"
}

func (p *PlatformSubscriptionPlanProfile) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	p.CreatedAt, p.UpdatedAt = now, now
	if p.Version <= 0 {
		p.Version = 1
	}
	return nil
}

func (p *PlatformSubscriptionPlanProfile) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

// PlatformSubscriptionLifecycle stores product lifecycle and immutable purchase
// snapshots for an upstream UserSubscription.
type PlatformSubscriptionLifecycle struct {
	Id                 int    `json:"id"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"not null;uniqueIndex"`
	UserId             int    `json:"user_id" gorm:"not null;index"`
	PlanId             int    `json:"plan_id" gorm:"not null;index"`
	PlanKeySnapshot    string `json:"plan_key_snapshot" gorm:"type:varchar(80);not null"`
	NameZhSnapshot     string `json:"name_zh_snapshot" gorm:"type:varchar(128);not null"`
	NameEnSnapshot     string `json:"name_en_snapshot" gorm:"type:varchar(128);not null"`
	PriceSnapshot      string `json:"price_snapshot" gorm:"type:varchar(40);not null"`
	CurrencySnapshot   string `json:"currency_snapshot" gorm:"type:varchar(8);not null"`
	LifecycleState     string `json:"lifecycle_state" gorm:"type:varchar(24);not null;index;check:chk_platform_subscription_state,lifecycle_state IN ('pending','active','canceling','canceled','expired','failed','renewal_failed')"`
	CancelAtPeriodEnd  bool   `json:"cancel_at_period_end" gorm:"not null"`
	AutoRenew          bool   `json:"auto_renew" gorm:"not null;index"`
	RenewalAttemptedAt int64  `json:"renewal_attempted_at" gorm:"type:bigint;not null;default:0"`
	RenewalFailure     string `json:"renewal_failure" gorm:"type:varchar(255);not null;default:''"`
	LatestOrderId      int    `json:"latest_order_id" gorm:"not null;default:0"`
	CreatedAt          int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt          int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

func (PlatformSubscriptionLifecycle) TableName() string { return "platform_subscription_lifecycles" }

func (s *PlatformSubscriptionLifecycle) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	s.CreatedAt, s.UpdatedAt = now, now
	return nil
}
func (s *PlatformSubscriptionLifecycle) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

type PlatformSubscriptionEvent struct {
	Id                 int    `json:"id"`
	EventKey           string `json:"event_key" gorm:"type:varchar(160);not null;uniqueIndex"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"not null;index"`
	UserId             int    `json:"user_id" gorm:"not null;index"`
	EventType          string `json:"event_type" gorm:"type:varchar(48);not null;index"`
	ActorType          string `json:"actor_type" gorm:"type:varchar(24);not null"`
	ActorId            int    `json:"actor_id" gorm:"not null;default:0"`
	Metadata           string `json:"metadata" gorm:"type:text"`
	CreatedAt          int64  `json:"created_at" gorm:"type:bigint;not null;index"`
}

func (PlatformSubscriptionEvent) TableName() string { return "platform_subscription_events" }
func (e *PlatformSubscriptionEvent) BeforeCreate(tx *gorm.DB) error {
	if e.CreatedAt == 0 {
		e.CreatedAt = common.GetTimestamp()
	}
	return nil
}

type PlatformSubscriptionRequest struct {
	Id                 int    `json:"id"`
	UserId             int    `json:"user_id" gorm:"not null;uniqueIndex:idx_platform_subscription_request"`
	Operation          string `json:"operation" gorm:"type:varchar(32);not null;uniqueIndex:idx_platform_subscription_request"`
	IdempotencyKey     string `json:"idempotency_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_platform_subscription_request"`
	RequestHash        string `json:"request_hash" gorm:"type:varchar(64);not null"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"not null;default:0"`
	OrderId            int    `json:"order_id" gorm:"not null;default:0"`
	Status             string `json:"status" gorm:"type:varchar(16);not null"`
	CreatedAt          int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt          int64  `json:"updated_at" gorm:"type:bigint;not null"`
}

func (PlatformSubscriptionRequest) TableName() string { return "platform_subscription_requests" }
func (r *PlatformSubscriptionRequest) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	r.CreatedAt, r.UpdatedAt = now, now
	return nil
}

type PlatformPlanView struct {
	Profile PlatformSubscriptionPlanProfile `json:"profile"`
	Plan    SubscriptionPlan                `json:"plan"`
}

type PlatformSubscriptionView struct {
	Lifecycle    PlatformSubscriptionLifecycle `json:"lifecycle"`
	Subscription UserSubscription              `json:"subscription"`
	Entitlements map[string]interface{}        `json:"entitlements"`
}

type PlatformSubscriptionPlanSeed struct {
	Profile PlatformSubscriptionPlanProfile
	Plan    SubscriptionPlan
}

// SeedPlatformSubscriptionPlans is create-only and therefore idempotent: an
// operator edit to an existing plan_key is never overwritten by a later seed.
func SeedPlatformSubscriptionPlans(seeds []PlatformSubscriptionPlanSeed) error {
	for _, seed := range seeds {
		key := normalizePlanKey(seed.Profile.PlanKey)
		var count int64
		if err := DB.Model(&PlatformSubscriptionPlanProfile{}).Where("plan_key = ?", key).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		seed.Profile.PlanKey = key
		if _, err := UpsertPlatformPlan(seed.Profile, seed.Plan); err != nil {
			return err
		}
	}
	return nil
}

func normalizePlanKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validatePlatformPlanProfile(p *PlatformSubscriptionPlanProfile) error {
	p.PlanKey = normalizePlanKey(p.PlanKey)
	if p.PlanKey == "" || p.NameZh == "" || p.NameEn == "" {
		return errors.New("plan_key and localized names are required")
	}
	if containsMarkup(p.NameZh, p.NameEn, p.DescriptionZh, p.DescriptionEn) {
		return errors.New("plan names and descriptions must not contain HTML")
	}
	for _, r := range p.PlanKey {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' && r != '_' {
			return errors.New("plan_key may contain only lowercase letters, digits, hyphens, and underscores")
		}
	}
	switch p.Visibility {
	case "public", "private", "internal":
	default:
		return errors.New("invalid visibility")
	}
	switch p.LifecycleState {
	case PlatformPlanStateDraft, PlatformPlanStateActive, PlatformPlanStateArchived:
	default:
		return errors.New("invalid plan lifecycle_state")
	}
	if p.LifecycleState == PlatformPlanStateArchived {
		p.PurchaseEnabled = false
		p.RenewalEnabled = false
	}
	return nil
}

func validatePlatformSubscriptionPlan(plan *SubscriptionPlan) error {
	if strings.TrimSpace(plan.Title) == "" {
		return errors.New("plan title is required")
	}
	if math.IsNaN(plan.PriceAmount) || math.IsInf(plan.PriceAmount, 0) || plan.PriceAmount < 0 || plan.PriceAmount > 999999.99 {
		return errors.New("plan price must be between 0 and 999999.99")
	}
	if plan.TotalAmount < 0 || plan.MaxPurchasePerUser < 0 {
		return errors.New("quota and purchase limit must be non-negative")
	}
	if _, err := calcPlanEndTime(time.Now(), plan); err != nil {
		return err
	}
	plan.QuotaResetPeriod = strings.TrimSpace(plan.QuotaResetPeriod)
	if plan.QuotaResetPeriod == "" {
		plan.QuotaResetPeriod = SubscriptionResetNever
	}
	switch plan.QuotaResetPeriod {
	case SubscriptionResetNever, SubscriptionResetDaily, SubscriptionResetWeekly, SubscriptionResetMonthly:
	case SubscriptionResetCustom:
		if plan.QuotaResetCustomSeconds <= 0 {
			return errors.New("quota_reset_custom_seconds must be positive for a custom reset period")
		}
	default:
		return errors.New("invalid quota_reset_period")
	}
	return nil
}

func ListPublicPlatformPlans() ([]PlatformPlanView, error) {
	var profiles []PlatformSubscriptionPlanProfile
	if err := DB.Where("visibility = ? AND lifecycle_state = ?", "public", PlatformPlanStateActive).Order("id asc").Find(&profiles).Error; err != nil {
		return nil, err
	}
	return hydratePlatformPlans(profiles)
}

func ListAdminPlatformPlans() ([]PlatformPlanView, error) {
	var profiles []PlatformSubscriptionPlanProfile
	if err := DB.Order("id desc").Find(&profiles).Error; err != nil {
		return nil, err
	}
	return hydratePlatformPlans(profiles)
}

func GetAdminPlatformPlan(id int) (*PlatformPlanView, error) {
	var profile PlatformSubscriptionPlanProfile
	if err := DB.Where("id = ?", id).First(&profile).Error; err != nil {
		return nil, err
	}
	views, err := hydratePlatformPlans([]PlatformSubscriptionPlanProfile{profile})
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

func GetPublicPlatformPlan(planKey string) (*PlatformPlanView, error) {
	var profile PlatformSubscriptionPlanProfile
	if err := DB.Where("plan_key = ? AND visibility = ? AND lifecycle_state = ?", normalizePlanKey(planKey), "public", PlatformPlanStateActive).First(&profile).Error; err != nil {
		return nil, err
	}
	views, err := hydratePlatformPlans([]PlatformSubscriptionPlanProfile{profile})
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

func IsPlatformSubscriptionPlan(planId int) (bool, error) {
	if planId <= 0 {
		return false, errors.New("invalid plan id")
	}
	var count int64
	err := DB.Model(&PlatformSubscriptionPlanProfile{}).Where("plan_id = ?", planId).Count(&count).Error
	return count > 0, err
}

func hydratePlatformPlans(profiles []PlatformSubscriptionPlanProfile) ([]PlatformPlanView, error) {
	result := make([]PlatformPlanView, 0, len(profiles))
	for _, profile := range profiles {
		var plan SubscriptionPlan
		if err := DB.Where("id = ?", profile.PlanId).First(&plan).Error; err != nil {
			return nil, err
		}
		plan.NormalizeDefaults()
		result = append(result, PlatformPlanView{Profile: profile, Plan: plan})
	}
	return result, nil
}

func UpsertPlatformPlan(profile PlatformSubscriptionPlanProfile, plan SubscriptionPlan) (*PlatformPlanView, error) {
	if err := validatePlatformPlanProfile(&profile); err != nil {
		return nil, err
	}
	plan.Currency = "USD"
	plan.NormalizeDefaults()
	if err := validatePlatformSubscriptionPlan(&plan); err != nil {
		return nil, err
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if profile.Id == 0 {
			if profile.LifecycleState == PlatformPlanStateArchived {
				return errors.New("new plans must be draft or active")
			}
			plan.Id = 0
			if err := tx.Create(&plan).Error; err != nil {
				return err
			}
			profile.PlanId = plan.Id
			return tx.Create(&profile).Error
		}
		var current PlatformSubscriptionPlanProfile
		if err := lockForUpdate(tx).Where("id = ?", profile.Id).First(&current).Error; err != nil {
			return err
		}
		if current.LifecycleState == PlatformPlanStateArchived && profile.LifecycleState != PlatformPlanStateArchived {
			return errors.New("archived plans cannot be reactivated")
		}
		if current.LifecycleState != PlatformPlanStateArchived && profile.LifecycleState == PlatformPlanStateArchived {
			return errors.New("use the archive operation to archive a plan")
		}
		if normalizePlanKey(profile.PlanKey) != current.PlanKey {
			return errors.New("plan_key is immutable")
		}
		var currentPlan SubscriptionPlan
		if err := lockForUpdate(tx).Where("id = ?", current.PlanId).First(&currentPlan).Error; err != nil {
			return err
		}
		profile.PlanId = current.PlanId
		profile.PlanKey = current.PlanKey
		profile.CreatedAt = current.CreatedAt
		profile.ArchivedAt = current.ArchivedAt
		profile.Version = current.Version + 1
		plan.Id = current.PlanId
		plan.CreatedAt = currentPlan.CreatedAt
		if err := tx.Save(&plan).Error; err != nil {
			return err
		}
		return tx.Save(&profile).Error
	})
	if err != nil {
		return nil, err
	}
	InvalidateSubscriptionPlanCache(profile.PlanId)
	return &PlatformPlanView{Profile: profile, Plan: plan}, nil
}

func ArchivePlatformPlan(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var p PlatformSubscriptionPlanProfile
		if err := lockForUpdate(tx).Where("id = ?", id).First(&p).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if err := tx.Model(&p).Updates(map[string]interface{}{"lifecycle_state": PlatformPlanStateArchived, "purchase_enabled": false, "renewal_enabled": false, "archived_at": now, "version": p.Version + 1, "updated_at": now}).Error; err != nil {
			return err
		}
		return tx.Model(&SubscriptionPlan{}).Where("id = ?", p.PlanId).Updates(map[string]interface{}{"enabled": false, "updated_at": now}).Error
	})
}

func requestHash(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(h[:])
}

func eventKey(eventType string, subscriptionId int, suffix string) string {
	return fmt.Sprintf("%s:%d:%s", eventType, subscriptionId, suffix)
}

func createPlatformEventTx(tx *gorm.DB, event PlatformSubscriptionEvent) error {
	return tx.Where("event_key = ?", event.EventKey).FirstOrCreate(&event).Error
}

func lifecycleFromPlan(sub *UserSubscription, plan *SubscriptionPlan, profile *PlatformSubscriptionPlanProfile, orderId int) PlatformSubscriptionLifecycle {
	return PlatformSubscriptionLifecycle{UserSubscriptionId: sub.Id, UserId: sub.UserId, PlanId: plan.Id, PlanKeySnapshot: profile.PlanKey, NameZhSnapshot: profile.NameZh, NameEnSnapshot: profile.NameEn, PriceSnapshot: fmt.Sprintf("%.6f", plan.PriceAmount), CurrencySnapshot: plan.Currency, LifecycleState: PlatformSubscriptionStateActive, LatestOrderId: orderId}
}

func platformEntitlements(sub UserSubscription) map[string]interface{} {
	remaining := sub.AmountTotal - sub.AmountUsed
	if sub.AmountTotal == 0 {
		remaining = 0
	}
	if remaining < 0 {
		remaining = 0
	}
	return map[string]interface{}{"quota_total": sub.AmountTotal, "quota_used": sub.AmountUsed, "quota_remaining": remaining, "quota_unlimited": sub.AmountTotal == 0, "allow_wallet_overflow": sub.AllowWalletOverflow, "access_group": sub.UpgradeGroup, "active": sub.Status == "active" && sub.EndTime > common.GetTimestamp()}
}

func getPlatformSubscriptionViewTx(tx *gorm.DB, subscriptionId, userId int) (*PlatformSubscriptionView, error) {
	var lifecycle PlatformSubscriptionLifecycle
	q := tx.Where("user_subscription_id = ?", subscriptionId)
	if userId > 0 {
		q = q.Where("user_id = ?", userId)
	}
	if err := q.First(&lifecycle).Error; err != nil {
		return nil, err
	}
	var sub UserSubscription
	if err := tx.Where("id = ?", lifecycle.UserSubscriptionId).First(&sub).Error; err != nil {
		return nil, err
	}
	return &PlatformSubscriptionView{Lifecycle: lifecycle, Subscription: sub, Entitlements: platformEntitlements(sub)}, nil
}

func ListPlatformSubscriptions(userId int, currentOnly bool) ([]PlatformSubscriptionView, error) {
	var lifecycles []PlatformSubscriptionLifecycle
	q := DB.Where("user_id = ?", userId).Order("id desc")
	if currentOnly {
		q = q.Where("lifecycle_state IN ?", []string{PlatformSubscriptionStateActive, PlatformSubscriptionStateCanceling, PlatformSubscriptionStateRenewalFailed})
	}
	if err := q.Find(&lifecycles).Error; err != nil {
		return nil, err
	}
	result := make([]PlatformSubscriptionView, 0, len(lifecycles))
	for _, lifecycle := range lifecycles {
		view, err := getPlatformSubscriptionViewTx(DB, lifecycle.UserSubscriptionId, userId)
		if err != nil {
			return nil, err
		}
		result = append(result, *view)
	}
	return result, nil
}

func GetPlatformSubscription(subscriptionId, userId int) (*PlatformSubscriptionView, error) {
	return getPlatformSubscriptionViewTx(DB, subscriptionId, userId)
}

func ListAdminPlatformSubscriptions(userId int, state, planKey string, limit int) ([]PlatformSubscriptionView, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var lifecycles []PlatformSubscriptionLifecycle
	query := DB.Order("id desc").Limit(limit)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	if strings.TrimSpace(state) != "" {
		query = query.Where("lifecycle_state = ?", strings.TrimSpace(state))
	}
	if strings.TrimSpace(planKey) != "" {
		query = query.Where("plan_key_snapshot = ?", normalizePlanKey(planKey))
	}
	if err := query.Find(&lifecycles).Error; err != nil {
		return nil, err
	}
	result := make([]PlatformSubscriptionView, 0, len(lifecycles))
	for _, lifecycle := range lifecycles {
		view, err := getPlatformSubscriptionViewTx(DB, lifecycle.UserSubscriptionId, 0)
		if err != nil {
			return nil, err
		}
		result = append(result, *view)
	}
	return result, nil
}

func ListPlatformSubscriptionEvents(subscriptionId, userId int) ([]PlatformSubscriptionEvent, error) {
	var lifecycle PlatformSubscriptionLifecycle
	q := DB.Where("user_subscription_id = ?", subscriptionId)
	if userId > 0 {
		q = q.Where("user_id = ?", userId)
	}
	if err := q.First(&lifecycle).Error; err != nil {
		return nil, err
	}
	var events []PlatformSubscriptionEvent
	err := DB.Where("user_subscription_id = ?", subscriptionId).Order("id asc").Find(&events).Error
	return events, err
}

// PurchasePlatformSubscriptionWithBalance is the authoritative idempotent product purchase path.
func PurchasePlatformSubscriptionWithBalance(userId int, planKey, idempotencyKey string) (*PlatformSubscriptionView, error) {
	planKey, idempotencyKey = normalizePlanKey(planKey), strings.TrimSpace(idempotencyKey)
	if userId <= 0 || planKey == "" || idempotencyKey == "" || len(idempotencyKey) > 128 {
		return nil, errors.New("valid plan_key and Idempotency-Key are required")
	}
	hash := requestHash(planKey)
	var result *PlatformSubscriptionView
	var chargedQuota int
	var groupChanged bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		var existing PlatformSubscriptionRequest
		r := tx.Where("user_id = ? AND operation = ? AND idempotency_key = ?", userId, "purchase", idempotencyKey).First(&existing)
		if r.Error == nil {
			if existing.RequestHash != hash {
				return errors.New("idempotency key was already used for a different request")
			}
			view, err := getPlatformSubscriptionViewTx(tx, existing.UserSubscriptionId, userId)
			result = view
			return err
		}
		if !errors.Is(r.Error, gorm.ErrRecordNotFound) {
			return r.Error
		}
		var profile PlatformSubscriptionPlanProfile
		if err := tx.Where("plan_key = ?", planKey).First(&profile).Error; err != nil {
			return err
		}
		if profile.Visibility != "public" || profile.LifecycleState != PlatformPlanStateActive || !profile.PurchaseEnabled {
			return errors.New("plan is not available for purchase")
		}
		plan, err := getSubscriptionPlanByIdTx(tx, profile.PlanId)
		if err != nil {
			return err
		}
		if !plan.Enabled || (plan.AllowBalancePay != nil && !*plan.AllowBalancePay) {
			return errors.New("plan is not available for wallet purchase")
		}
		requiredQuota, err := calcSubscriptionBalanceQuota(plan.PriceAmount)
		if err != nil {
			return err
		}
		if user.Quota < requiredQuota {
			return errors.New("insufficient wallet balance")
		}
		if requiredQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota - ?", requiredQuota)).Error; err != nil {
				return err
			}
		}
		sub, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, PaymentMethodBalance)
		if err != nil {
			return err
		}
		now := common.GetTimestamp()
		order := SubscriptionOrder{UserId: userId, PlanId: plan.Id, Money: plan.PriceAmount, TradeNo: fmt.Sprintf("SUBPLAT%d%s%d", userId, common.GetRandomString(8), time.Now().UnixNano()), PaymentMethod: PaymentMethodBalance, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess, CreateTime: now, CompleteTime: now, ProviderPayload: fmt.Sprintf("charged_quota=%d", requiredQuota)}
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		lifecycle := lifecycleFromPlan(sub, plan, &profile, order.Id)
		if err := tx.Create(&lifecycle).Error; err != nil {
			return err
		}
		if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey("purchased", sub.Id, idempotencyKey), UserSubscriptionId: sub.Id, UserId: userId, EventType: "purchased", ActorType: "user", ActorId: userId, Metadata: fmt.Sprintf("{\"order_id\":%d,\"charged_quota\":%d}", order.Id, requiredQuota)}); err != nil {
			return err
		}
		for _, eventType := range []string{"created", "activated", "entitlement_applied"} {
			if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey(eventType, sub.Id, idempotencyKey), UserSubscriptionId: sub.Id, UserId: userId, EventType: eventType, ActorType: "system"}); err != nil {
				return err
			}
		}
		req := PlatformSubscriptionRequest{UserId: userId, Operation: "purchase", IdempotencyKey: idempotencyKey, RequestHash: hash, UserSubscriptionId: sub.Id, OrderId: order.Id, Status: "succeeded"}
		if err := tx.Create(&req).Error; err != nil {
			return err
		}
		result = &PlatformSubscriptionView{Lifecycle: lifecycle, Subscription: *sub, Entitlements: platformEntitlements(*sub)}
		chargedQuota, groupChanged = requiredQuota, sub.PrevUserGroup != ""
		return nil
	})
	if err != nil {
		return nil, err
	}
	if chargedQuota > 0 {
		if err := cacheDecrUserQuota(userId, int64(chargedQuota)); err != nil {
			common.SysError("platform subscription wallet cache update failed: " + err.Error())
		}
	}
	if groupChanged {
		refreshSubscriptionUserGroupCache(userId, "platform subscription purchase")
	}
	return result, nil
}

func SetPlatformSubscriptionAutoRenew(subscriptionId, userId int, enabled bool) (*PlatformSubscriptionView, error) {
	var result *PlatformSubscriptionView
	err := DB.Transaction(func(tx *gorm.DB) error {
		var lifecycle PlatformSubscriptionLifecycle
		if err := lockForUpdate(tx).Where("user_subscription_id = ? AND user_id = ?", subscriptionId, userId).First(&lifecycle).Error; err != nil {
			return err
		}
		var sub UserSubscription
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", subscriptionId, userId).First(&sub).Error; err != nil {
			return err
		}
		var profile PlatformSubscriptionPlanProfile
		if err := tx.Where("plan_id = ?", lifecycle.PlanId).First(&profile).Error; err != nil {
			return err
		}
		if enabled && (!profile.RenewalEnabled || profile.LifecycleState != PlatformPlanStateActive) {
			return errors.New("renewal is not enabled for this plan")
		}
		if enabled && (lifecycle.LifecycleState != PlatformSubscriptionStateActive || sub.Status != "active" || sub.EndTime <= common.GetTimestamp()) {
			return errors.New("only an active subscription can enable auto renewal")
		}
		if lifecycle.CancelAtPeriodEnd && enabled {
			return errors.New("resume the subscription before enabling auto renewal")
		}
		if err := tx.Model(&lifecycle).Updates(map[string]interface{}{"auto_renew": enabled, "updated_at": common.GetTimestamp()}).Error; err != nil {
			return err
		}
		eventType := "auto_renew_disabled"
		if enabled {
			eventType = "auto_renew_enabled"
		}
		if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey(eventType, subscriptionId, fmt.Sprint(common.GetTimestamp())), UserSubscriptionId: subscriptionId, UserId: userId, EventType: eventType, ActorType: "user", ActorId: userId}); err != nil {
			return err
		}
		view, err := getPlatformSubscriptionViewTx(tx, subscriptionId, userId)
		result = view
		return err
	})
	return result, err
}

func CancelPlatformSubscription(subscriptionId, userId int, immediate bool, actorType string, actorId int, reason string) (*PlatformSubscriptionView, error) {
	var result *PlatformSubscriptionView
	var groupChanged bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var lifecycle PlatformSubscriptionLifecycle
		q := lockForUpdate(tx).Where("user_subscription_id = ?", subscriptionId)
		if userId > 0 {
			q = q.Where("user_id = ?", userId)
		}
		if err := q.First(&lifecycle).Error; err != nil {
			return err
		}
		var sub UserSubscription
		if err := lockForUpdate(tx).Where("id = ?", subscriptionId).First(&sub).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if !immediate {
			if lifecycle.LifecycleState == PlatformSubscriptionStateCanceling && lifecycle.CancelAtPeriodEnd && sub.Status == "active" && sub.EndTime > now {
				view, err := getPlatformSubscriptionViewTx(tx, subscriptionId, lifecycle.UserId)
				result = view
				return err
			}
			if lifecycle.LifecycleState != PlatformSubscriptionStateActive || sub.Status != "active" || sub.EndTime <= now {
				return errors.New("only an active subscription can schedule cancellation")
			}
		} else if lifecycle.LifecycleState == PlatformSubscriptionStateCanceled || lifecycle.LifecycleState == PlatformSubscriptionStateExpired || lifecycle.LifecycleState == PlatformSubscriptionStateFailed {
			return errors.New("a terminal subscription cannot be canceled again")
		}
		state, eventType := PlatformSubscriptionStateCanceling, "cancel_scheduled"
		updates := map[string]interface{}{"cancel_at_period_end": true, "auto_renew": false, "lifecycle_state": state, "updated_at": now}
		if immediate {
			state, eventType = PlatformSubscriptionStateCanceled, "canceled"
			updates["cancel_at_period_end"], updates["lifecycle_state"] = false, state
			if err := tx.Model(&sub).Updates(map[string]interface{}{"status": "cancelled", "end_time": now, "updated_at": now}).Error; err != nil {
				return err
			}
			target, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now)
			if err != nil {
				return err
			}
			groupChanged = target != ""
		}
		if err := tx.Model(&lifecycle).Updates(updates).Error; err != nil {
			return err
		}
		metadata := ""
		if strings.TrimSpace(reason) != "" {
			metadata = fmt.Sprintf("{\"reason\":%q}", strings.TrimSpace(reason))
		}
		if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey(eventType, subscriptionId, fmt.Sprint(now)), UserSubscriptionId: subscriptionId, UserId: lifecycle.UserId, EventType: eventType, ActorType: actorType, ActorId: actorId, Metadata: metadata}); err != nil {
			return err
		}
		if immediate {
			if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey("entitlement_removed", subscriptionId, fmt.Sprint(now)), UserSubscriptionId: subscriptionId, UserId: lifecycle.UserId, EventType: "entitlement_removed", ActorType: actorType, ActorId: actorId, Metadata: metadata}); err != nil {
				return err
			}
		}
		view, err := getPlatformSubscriptionViewTx(tx, subscriptionId, lifecycle.UserId)
		result = view
		return err
	})
	if err == nil && groupChanged {
		refreshSubscriptionUserGroupCache(result.Subscription.UserId, "platform subscription cancellation")
	}
	return result, err
}

func RevokePlatformSubscriptionCancellation(subscriptionId, userId int) (*PlatformSubscriptionView, error) {
	var result *PlatformSubscriptionView
	err := DB.Transaction(func(tx *gorm.DB) error {
		var lifecycle PlatformSubscriptionLifecycle
		if err := lockForUpdate(tx).Where("user_subscription_id = ? AND user_id = ?", subscriptionId, userId).First(&lifecycle).Error; err != nil {
			return err
		}
		var sub UserSubscription
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", subscriptionId, userId).First(&sub).Error; err != nil {
			return err
		}
		if lifecycle.LifecycleState != PlatformSubscriptionStateCanceling || !lifecycle.CancelAtPeriodEnd {
			return errors.New("subscription does not have a scheduled cancellation")
		}
		now := common.GetTimestamp()
		if sub.Status != "active" || sub.EndTime <= now {
			return errors.New("an ended subscription cannot revoke cancellation")
		}
		if err := tx.Model(&lifecycle).Updates(map[string]interface{}{"lifecycle_state": PlatformSubscriptionStateActive, "cancel_at_period_end": false, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey("cancellation_revoked", subscriptionId, fmt.Sprint(now)), UserSubscriptionId: subscriptionId, UserId: userId, EventType: "cancellation_revoked", ActorType: "user", ActorId: userId}); err != nil {
			return err
		}
		view, err := getPlatformSubscriptionViewTx(tx, subscriptionId, userId)
		result = view
		return err
	})
	return result, err
}

func RenewPlatformSubscriptionWithBalance(subscriptionId, userId int, idempotencyKey, actorType string, actorId int) (*PlatformSubscriptionView, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if subscriptionId <= 0 || userId <= 0 || idempotencyKey == "" || len(idempotencyKey) > 128 {
		return nil, errors.New("subscription and Idempotency-Key are required")
	}
	hash := requestHash(fmt.Sprint(subscriptionId))
	var result *PlatformSubscriptionView
	var charged int
	var groupChanged bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		var existing PlatformSubscriptionRequest
		r := tx.Where("user_id = ? AND operation = ? AND idempotency_key = ?", userId, "renew", idempotencyKey).First(&existing)
		if r.Error == nil {
			if existing.RequestHash != hash {
				return errors.New("idempotency key was already used for a different request")
			}
			view, err := getPlatformSubscriptionViewTx(tx, existing.UserSubscriptionId, userId)
			result = view
			return err
		}
		if !errors.Is(r.Error, gorm.ErrRecordNotFound) {
			return r.Error
		}
		var lifecycle PlatformSubscriptionLifecycle
		if err := lockForUpdate(tx).Where("user_subscription_id = ? AND user_id = ?", subscriptionId, userId).First(&lifecycle).Error; err != nil {
			return err
		}
		var sub UserSubscription
		if err := lockForUpdate(tx).Where("id = ?", subscriptionId).First(&sub).Error; err != nil {
			return err
		}
		if sub.Status != "active" && !(sub.Status == "expired" && lifecycle.LifecycleState == PlatformSubscriptionStateRenewalFailed) {
			return errors.New("only an active subscription can be renewed")
		}
		var profile PlatformSubscriptionPlanProfile
		if err := tx.Where("plan_id = ?", sub.PlanId).First(&profile).Error; err != nil {
			return err
		}
		if !profile.RenewalEnabled || profile.LifecycleState != PlatformPlanStateActive {
			return errors.New("renewal is not enabled for this plan")
		}
		plan, err := getSubscriptionPlanByIdTx(tx, sub.PlanId)
		if err != nil {
			return err
		}
		renewalPrice, err := strconv.ParseFloat(lifecycle.PriceSnapshot, 64)
		if err != nil || math.IsNaN(renewalPrice) || math.IsInf(renewalPrice, 0) || renewalPrice < 0 {
			return errors.New("subscription price snapshot is invalid")
		}
		required, err := calcSubscriptionBalanceQuota(renewalPrice)
		if err != nil {
			return err
		}
		if user.Quota < required {
			return errors.New("insufficient wallet balance")
		}
		if required > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota - ?", required)).Error; err != nil {
				return err
			}
		}
		now := common.GetTimestamp()
		periodEnded := sub.EndTime <= now || lifecycle.LifecycleState == PlatformSubscriptionStateRenewalFailed
		base := time.Unix(now, 0)
		if sub.EndTime > base.Unix() {
			base = time.Unix(sub.EndTime, 0)
		}
		end, err := calcPlanEndTime(base, plan)
		if err != nil {
			return err
		}
		sub.EndTime, sub.Status = end, "active"
		subUpdates := map[string]interface{}{"end_time": end, "status": "active", "updated_at": now}
		if periodEnded {
			sub.AmountTotal = plan.TotalAmount
			sub.AmountUsed = 0
			sub.LastResetTime = now
			sub.NextResetTime = calcNextResetTime(time.Unix(now, 0), plan, end)
			subUpdates["amount_total"] = sub.AmountTotal
			subUpdates["amount_used"] = 0
			subUpdates["last_reset_time"] = sub.LastResetTime
			subUpdates["next_reset_time"] = sub.NextResetTime
			upgradeGroup := strings.TrimSpace(sub.UpgradeGroup)
			if upgradeGroup != "" {
				currentGroup, err := getUserGroupByIdTx(tx, userId)
				if err != nil {
					return err
				}
				if currentGroup != upgradeGroup {
					if err := tx.Model(&User{}).Where("id = ?", userId).Update("group", upgradeGroup).Error; err != nil {
						return err
					}
					groupChanged = true
				}
			}
		} else if NormalizeResetPeriod(plan.QuotaResetPeriod) == SubscriptionResetNever && plan.TotalAmount > 0 {
			// An early manual renewal buys another non-expiring allotment without
			// discarding the unused quota from the current paid period.
			sub.AmountTotal += plan.TotalAmount
			subUpdates["amount_total"] = sub.AmountTotal
		}
		if err := tx.Model(&sub).Updates(subUpdates).Error; err != nil {
			return err
		}
		order := SubscriptionOrder{UserId: userId, PlanId: plan.Id, Money: renewalPrice, TradeNo: fmt.Sprintf("SUBREN%d%s%d", userId, common.GetRandomString(8), time.Now().UnixNano()), PaymentMethod: PaymentMethodBalance, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess, CreateTime: now, CompleteTime: now, ProviderPayload: fmt.Sprintf("renewal_of=%d;charged_quota=%d", subscriptionId, required)}
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		if err := tx.Model(&lifecycle).Updates(map[string]interface{}{"lifecycle_state": PlatformSubscriptionStateActive, "cancel_at_period_end": false, "renewal_attempted_at": now, "renewal_failure": "", "latest_order_id": order.Id, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey("renewed", subscriptionId, idempotencyKey), UserSubscriptionId: subscriptionId, UserId: userId, EventType: "renewed", ActorType: actorType, ActorId: actorId, Metadata: fmt.Sprintf("{\"order_id\":%d,\"charged_quota\":%d,\"end_time\":%d}", order.Id, required, end)}); err != nil {
			return err
		}
		req := PlatformSubscriptionRequest{UserId: userId, Operation: "renew", IdempotencyKey: idempotencyKey, RequestHash: hash, UserSubscriptionId: subscriptionId, OrderId: order.Id, Status: "succeeded"}
		if err := tx.Create(&req).Error; err != nil {
			return err
		}
		view, err := getPlatformSubscriptionViewTx(tx, subscriptionId, userId)
		result = view
		charged = required
		return err
	})
	if err != nil {
		return nil, err
	}
	if charged > 0 {
		if err := cacheDecrUserQuota(userId, int64(charged)); err != nil {
			common.SysError("subscription renewal wallet cache update failed: " + err.Error())
		}
	}
	if groupChanged {
		refreshSubscriptionUserGroupCache(userId, "platform subscription renewal")
	}
	return result, nil
}

func ProcessDuePlatformSubscriptionRenewals(limit int) (int, error) {
	if limit <= 0 {
		limit = 100
	}
	now := GetDBTimestamp()
	var lifecycles []PlatformSubscriptionLifecycle
	if err := DB.Table("platform_subscription_lifecycles AS l").Select("l.*").Joins("JOIN user_subscriptions AS s ON s.id = l.user_subscription_id").Where("l.auto_renew = ? AND l.lifecycle_state = ? AND s.status = ? AND s.end_time <= ?", true, PlatformSubscriptionStateActive, "active", now).Order("s.end_time asc").Limit(limit).Scan(&lifecycles).Error; err != nil {
		return 0, err
	}
	processed := 0
	for _, lifecycle := range lifecycles {
		var due UserSubscription
		if err := DB.Where("id = ?", lifecycle.UserSubscriptionId).First(&due).Error; err != nil {
			return processed, err
		}
		key := fmt.Sprintf("auto:%d:%d", lifecycle.UserSubscriptionId, due.EndTime)
		if _, err := RenewPlatformSubscriptionWithBalance(lifecycle.UserSubscriptionId, lifecycle.UserId, key, "system", 0); err != nil {
			failureNow := common.GetTimestamp()
			failureMessage := platformRenewalFailureMessage(err)
			if failureMessage != err.Error() {
				common.SysError(fmt.Sprintf("platform subscription %d renewal failed: %v", lifecycle.UserSubscriptionId, err))
			}
			if recordErr := DB.Transaction(func(tx *gorm.DB) error {
				var current PlatformSubscriptionLifecycle
				if e := lockForUpdate(tx).Where("id = ?", lifecycle.Id).First(&current).Error; e != nil {
					return e
				}
				var currentSub UserSubscription
				if e := lockForUpdate(tx).Where("id = ?", lifecycle.UserSubscriptionId).First(&currentSub).Error; e != nil {
					return e
				}
				if !current.AutoRenew || current.LifecycleState != PlatformSubscriptionStateActive || currentSub.Status != "active" || currentSub.EndTime != due.EndTime || currentSub.EndTime > failureNow {
					return nil
				}
				if e := tx.Model(&current).Updates(map[string]interface{}{"lifecycle_state": PlatformSubscriptionStateRenewalFailed, "auto_renew": false, "renewal_attempted_at": failureNow, "renewal_failure": failureMessage, "updated_at": failureNow}).Error; e != nil {
					return e
				}
				metadata := fmt.Sprintf("{\"reason\":%q}", failureMessage)
				if eventErr := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey("renewal_failed", lifecycle.UserSubscriptionId, fmt.Sprint(failureNow)), UserSubscriptionId: lifecycle.UserSubscriptionId, UserId: lifecycle.UserId, EventType: "renewal_failed", ActorType: "system", Metadata: metadata}); eventErr != nil {
					return eventErr
				}
				return createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey("failed", lifecycle.UserSubscriptionId, fmt.Sprint(failureNow)), UserSubscriptionId: lifecycle.UserSubscriptionId, UserId: lifecycle.UserId, EventType: "failed", ActorType: "system", Metadata: metadata})
			}); recordErr != nil {
				return processed, recordErr
			}
		}
		processed++
	}
	return processed, nil
}

func platformRenewalFailureMessage(err error) string {
	message := err.Error()
	for _, prefix := range []string{"insufficient wallet balance", "renewal is not enabled", "only an active subscription", "subscription price snapshot"} {
		if strings.HasPrefix(message, prefix) {
			return message
		}
	}
	return "renewal attempt failed"
}

func ReconcilePlatformSubscriptionLifecycles(limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	var lifecycles []PlatformSubscriptionLifecycle
	if err := DB.Table("platform_subscription_lifecycles AS l").Select("l.*").Joins("JOIN user_subscriptions AS s ON s.id = l.user_subscription_id").Where("(s.status = ? AND l.lifecycle_state <> ?) OR (s.status = ? AND l.lifecycle_state NOT IN ?)", "expired", PlatformSubscriptionStateExpired, "cancelled", []string{PlatformSubscriptionStateCanceled}).Limit(limit).Scan(&lifecycles).Error; err != nil {
		return 0, err
	}
	for _, lifecycle := range lifecycles {
		var sub UserSubscription
		if err := DB.Where("id = ?", lifecycle.UserSubscriptionId).First(&sub).Error; err != nil {
			return 0, err
		}
		state, eventType := PlatformSubscriptionStateExpired, "expired"
		if sub.Status == "cancelled" {
			state, eventType = PlatformSubscriptionStateCanceled, "canceled"
		} else if lifecycle.CancelAtPeriodEnd {
			state, eventType = PlatformSubscriptionStateCanceled, "canceled"
		} else if lifecycle.LifecycleState == PlatformSubscriptionStateRenewalFailed {
			continue
		}
		now := common.GetTimestamp()
		if err := DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&PlatformSubscriptionLifecycle{}).Where("id = ?", lifecycle.Id).Updates(map[string]interface{}{"lifecycle_state": state, "auto_renew": false, "updated_at": now}).Error; err != nil {
				return err
			}
			if err := createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey(eventType, lifecycle.UserSubscriptionId, fmt.Sprint(sub.EndTime)), UserSubscriptionId: lifecycle.UserSubscriptionId, UserId: lifecycle.UserId, EventType: eventType, ActorType: "system"}); err != nil {
				return err
			}
			return createPlatformEventTx(tx, PlatformSubscriptionEvent{EventKey: eventKey("entitlement_removed", lifecycle.UserSubscriptionId, fmt.Sprint(sub.EndTime)), UserSubscriptionId: lifecycle.UserSubscriptionId, UserId: lifecycle.UserId, EventType: "entitlement_removed", ActorType: "system"})
		}); err != nil {
			return 0, err
		}
	}
	return len(lifecycles), nil
}
