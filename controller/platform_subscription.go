package controller

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func platformPricingStatus() string {
	status := strings.TrimSpace(os.Getenv("PRICING_STATUS"))
	if status == "" {
		return "provisional"
	}
	return status
}

func platformPlanResponse(view interface{}) gin.H {
	return gin.H{"pricing_status": platformPricingStatus(), "plans": view}
}

func platformSubscriptionAPIError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorMsg(c, "subscription resource not found")
		return
	}
	message := err.Error()
	safePrefixes := []string{
		"plan_", "plan ", "invalid ", "unknown user group:", "purchase and renewal ",
		"payment compliance ", "archived plans ", "valid plan_key ", "idempotency key ",
		"insufficient wallet ", "renewal is ", "resume the subscription ",
		"subscription does not ", "subscription and Idempotency-Key ", "only an active ",
		"a terminal subscription ", "an ended subscription ", "subscription price snapshot ",
		"quota and purchase ", "duration_value ", "custom_seconds ",
		"quota_reset_custom_seconds ",
		"new plans ", "use the archive operation ",
	}
	for _, prefix := range safePrefixes {
		if strings.HasPrefix(message, prefix) {
			common.ApiErrorMsg(c, message)
			return
		}
	}
	common.SysError("platform subscription API failure: " + message)
	common.ApiErrorMsg(c, "subscription operation failed")
}

type publicPlatformSubscriptionPlan struct {
	PlanKey         string                 `json:"plan_key"`
	DisplayName     string                 `json:"display_name"`
	Description     string                 `json:"description"`
	Status          string                 `json:"status"`
	Price           float64                `json:"price"`
	Currency        string                 `json:"currency"`
	BillingPeriod   string                 `json:"billing_period"`
	DurationValue   int                    `json:"duration_value"`
	IncludedQuota   int64                  `json:"included_quota"`
	Entitlements    map[string]interface{} `json:"entitlements"`
	PurchaseEnabled bool                   `json:"purchase_enabled"`
	RenewalEnabled  bool                   `json:"renewal_enabled"`
}

func publicPlatformPlan(view model.PlatformPlanView, locale string) publicPlatformSubscriptionPlan {
	displayName, description := view.Profile.NameEn, view.Profile.DescriptionEn
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(locale)), "zh") {
		displayName, description = view.Profile.NameZh, view.Profile.DescriptionZh
	}
	return publicPlatformSubscriptionPlan{
		PlanKey: view.Profile.PlanKey, DisplayName: displayName, Description: description,
		Status: view.Profile.LifecycleState, Price: view.Plan.PriceAmount, Currency: view.Plan.Currency,
		BillingPeriod: view.Plan.DurationUnit, DurationValue: view.Plan.DurationValue,
		IncludedQuota:   view.Plan.TotalAmount,
		Entitlements:    map[string]interface{}{"quota_pool": "independent_period", "allow_wallet_overflow": view.Plan.AllowWalletOverflow, "access_group": view.Plan.UpgradeGroup},
		PurchaseEnabled: view.Profile.PurchaseEnabled && view.Plan.Enabled,
		RenewalEnabled:  view.Profile.RenewalEnabled,
	}
}

func ListPublicPlatformSubscriptionPlans(c *gin.Context) {
	plans, err := model.ListPublicPlatformPlans()
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	publicPlans := make([]publicPlatformSubscriptionPlan, 0, len(plans))
	for _, plan := range plans {
		publicPlans = append(publicPlans, publicPlatformPlan(plan, c.GetHeader("Accept-Language")))
	}
	common.ApiSuccess(c, platformPlanResponse(publicPlans))
}

func GetPublicPlatformSubscriptionPlan(c *gin.Context) {
	plan, err := model.GetPublicPlatformPlan(c.Param("plan_key"))
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"pricing_status": platformPricingStatus(), "plan": publicPlatformPlan(*plan, c.GetHeader("Accept-Language"))})
}

func GetCurrentPlatformSubscriptions(c *gin.Context) {
	subscriptions, err := model.ListPlatformSubscriptions(c.GetInt("id"), true)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"subscriptions": subscriptions, "pricing_status": platformPricingStatus()})
}

func GetPlatformSubscriptionHistory(c *gin.Context) {
	subscriptions, err := model.ListPlatformSubscriptions(c.GetInt("id"), false)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"subscriptions": subscriptions})
}

func GetPlatformSubscriptionEvents(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	events, err := model.ListPlatformSubscriptionEvents(id, c.GetInt("id"))
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, events)
}

type platformPurchaseRequest struct {
	PlanKey string `json:"plan_key"`
}

func PurchasePlatformSubscription(c *gin.Context) {
	if platformPricingStatus() != "published" {
		common.ApiErrorMsg(c, "subscription purchase is unavailable while pricing is provisional")
		return
	}
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorMsg(c, "payment compliance confirmation is required")
		return
	}
	var request platformPurchaseRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	result, err := model.PurchasePlatformSubscriptionWithBalance(c.GetInt("id"), request.PlanKey, c.GetHeader("Idempotency-Key"))
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func CancelPlatformSubscription(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	result, err := model.CancelPlatformSubscription(id, c.GetInt("id"), false, "user", c.GetInt("id"), "")
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func RevokePlatformSubscription(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	result, err := model.RevokePlatformSubscriptionCancellation(id, c.GetInt("id"))
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

type platformAutoRenewRequest struct {
	Enabled bool `json:"enabled"`
}

func SetPlatformSubscriptionAutoRenew(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var request platformAutoRenewRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	if request.Enabled && platformPricingStatus() != "published" {
		common.ApiErrorMsg(c, "subscription renewal is unavailable while pricing is provisional")
		return
	}
	if request.Enabled && !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorMsg(c, "payment compliance confirmation is required")
		return
	}
	result, err := model.SetPlatformSubscriptionAutoRenew(id, c.GetInt("id"), request.Enabled)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func RenewPlatformSubscription(c *gin.Context) {
	if platformPricingStatus() != "published" {
		common.ApiErrorMsg(c, "subscription renewal is unavailable while pricing is provisional")
		return
	}
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorMsg(c, "payment compliance confirmation is required")
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	result, err := model.RenewPlatformSubscriptionWithBalance(id, c.GetInt("id"), c.GetHeader("Idempotency-Key"), "user", c.GetInt("id"))
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

type adminPlatformPlanRequest struct {
	Profile model.PlatformSubscriptionPlanProfile `json:"profile"`
	Plan    model.SubscriptionPlan                `json:"plan"`
}

func validateAdminPlatformPlanRequest(request *adminPlatformPlanRequest) error {
	for _, group := range []string{request.Plan.UpgradeGroup, request.Plan.DowngradeGroup} {
		group = strings.TrimSpace(group)
		if group != "" && !ratio_setting.ContainsGroupRatio(group) {
			return fmt.Errorf("unknown user group: %s", group)
		}
	}
	if (request.Plan.Enabled || request.Profile.PurchaseEnabled || request.Profile.RenewalEnabled) && platformPricingStatus() != "published" {
		return errors.New("plan, purchase and renewal cannot be enabled while pricing is provisional")
	}
	if (request.Profile.PurchaseEnabled || request.Profile.RenewalEnabled) && !operation_setting.IsPaymentComplianceConfirmed() {
		return errors.New("payment compliance confirmation is required")
	}
	return nil
}

func AdminListPlatformSubscriptionPlans(c *gin.Context) {
	plans, err := model.ListAdminPlatformPlans()
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"plans": plans, "pricing_status": platformPricingStatus()})
}

func AdminGetPlatformSubscriptionPlan(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	plan, err := model.GetAdminPlatformPlan(id)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, plan)
}

func AdminCreatePlatformSubscriptionPlan(c *gin.Context) {
	var request adminPlatformPlanRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	if err := validateAdminPlatformPlanRequest(&request); err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	request.Profile.Id, request.Profile.PlanId = 0, 0
	result, err := model.UpsertPlatformPlan(request.Profile, request.Plan)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	recordManageAudit(c, "subscription.platform_plan_create", map[string]interface{}{"plan_key": result.Profile.PlanKey, "profile_id": result.Profile.Id, "version": result.Profile.Version})
	common.ApiSuccess(c, result)
}

func AdminUpdatePlatformSubscriptionPlan(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var request adminPlatformPlanRequest
	if err := c.ShouldBindJSON(&request); err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	before, err := model.GetAdminPlatformPlan(id)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	if err := validateAdminPlatformPlanRequest(&request); err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	request.Profile.Id = id
	result, err := model.UpsertPlatformPlan(request.Profile, request.Plan)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	recordManageAudit(c, "subscription.platform_plan_update", map[string]interface{}{
		"plan_key": result.Profile.PlanKey, "profile_id": result.Profile.Id, "version": result.Profile.Version,
		"before": map[string]interface{}{
			"price": before.Plan.PriceAmount, "currency": before.Plan.Currency, "quota": before.Plan.TotalAmount,
			"upgrade_group": before.Plan.UpgradeGroup, "visibility": before.Profile.Visibility,
			"purchase_enabled": before.Profile.PurchaseEnabled, "renewal_enabled": before.Profile.RenewalEnabled,
		},
		"after": map[string]interface{}{
			"price": result.Plan.PriceAmount, "currency": result.Plan.Currency, "quota": result.Plan.TotalAmount,
			"upgrade_group": result.Plan.UpgradeGroup, "visibility": result.Profile.Visibility,
			"purchase_enabled": result.Profile.PurchaseEnabled, "renewal_enabled": result.Profile.RenewalEnabled,
		},
	})
	common.ApiSuccess(c, result)
}

func AdminArchivePlatformSubscriptionPlan(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "invalid plan id")
		return
	}
	if err := model.ArchivePlatformPlan(id); err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	recordManageAudit(c, "subscription.platform_plan_archive", map[string]interface{}{"profile_id": id})
	common.ApiSuccess(c, nil)
}

func AdminListPlatformSubscriptions(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Query("user_id"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	result, err := model.ListAdminPlatformSubscriptions(userId, c.Query("state"), c.Query("plan_key"), limit)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func AdminGetPlatformSubscription(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	result, err := model.GetPlatformSubscription(id, 0)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	events, err := model.ListPlatformSubscriptionEvents(id, 0)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"subscription": result, "events": events})
}

func AdminCancelPlatformSubscription(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var request struct {
		Immediate bool   `json:"immediate"`
		Reason    string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	if request.Immediate && strings.TrimSpace(request.Reason) == "" {
		common.ApiErrorMsg(c, "reason is required for immediate termination")
		return
	}
	result, err := model.CancelPlatformSubscription(id, 0, request.Immediate, "admin", c.GetInt("id"), request.Reason)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	recordManageAuditFor(c, result.Subscription.UserId, "subscription.platform_cancel", map[string]interface{}{"subscription_id": id, "immediate": request.Immediate, "reason": strings.TrimSpace(request.Reason)})
	common.ApiSuccess(c, result)
}

func AdminRenewPlatformSubscription(c *gin.Context) {
	if platformPricingStatus() != "published" {
		common.ApiErrorMsg(c, "subscription renewal is unavailable while pricing is provisional")
		return
	}
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorMsg(c, "payment compliance confirmation is required")
		return
	}
	id, _ := strconv.Atoi(c.Param("id"))
	current, err := model.GetPlatformSubscription(id, 0)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	result, err := model.RenewPlatformSubscriptionWithBalance(id, current.Subscription.UserId, c.GetHeader("Idempotency-Key"), "admin", c.GetInt("id"))
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	recordManageAuditFor(c, result.Subscription.UserId, "subscription.platform_renew", map[string]interface{}{"subscription_id": id, "end_time": result.Subscription.EndTime})
	common.ApiSuccess(c, result)
}

func AdminReconcilePlatformSubscriptions(c *gin.Context) {
	renewed := 0
	if platformPricingStatus() == "published" && operation_setting.IsPaymentComplianceConfirmed() {
		var err error
		renewed, err = model.ProcessDuePlatformSubscriptionRenewals(200)
		if err != nil {
			platformSubscriptionAPIError(c, err)
			return
		}
	}
	reconciled, err := model.ReconcilePlatformSubscriptionLifecycles(200)
	if err != nil {
		platformSubscriptionAPIError(c, err)
		return
	}
	recordManageAudit(c, "subscription.platform_reconcile", map[string]interface{}{"renewal_attempts": renewed, "reconciled": reconciled})
	common.ApiSuccess(c, gin.H{"renewal_attempts": renewed, "reconciled": reconciled})
}
