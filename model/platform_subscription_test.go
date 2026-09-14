package model

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPlatformSubscriptionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousLogDB := DB, LOG_DB
	previousType := common.MainDatabaseType()
	previousQuotaPerUnit := common.QuotaPerUnit
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// CreateUserSubscriptionFromPlanTx reads the database clock through DB while
	// its write transaction is open, so the compatibility fixture needs a second
	// SQLite connection just like the existing subscription tests.
	sqlDB.SetMaxOpenConns(4)
	DB, LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.QuotaPerUnit = 100
	initCol()
	require.NoError(t, db.AutoMigrate(
		&User{}, &SubscriptionPlan{}, &SubscriptionOrder{}, &UserSubscription{},
		&PlatformSubscriptionPlanProfile{}, &PlatformSubscriptionLifecycle{},
		&PlatformSubscriptionEvent{}, &PlatformSubscriptionRequest{},
	))
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.QuotaPerUnit = previousQuotaPerUnit
		common.SetMainDatabaseType(previousType)
		initCol()
		_ = sqlDB.Close()
	})
	return db
}

func platformSubscriptionSeed(key string) PlatformSubscriptionPlanSeed {
	allow := true
	return PlatformSubscriptionPlanSeed{
		Profile: PlatformSubscriptionPlanProfile{PlanKey: key, NameZh: "开发者套餐", NameEn: "Developer", DescriptionZh: "测试", DescriptionEn: "Test", Visibility: "public", PurchaseEnabled: true, RenewalEnabled: true, LifecycleState: PlatformPlanStateActive},
		Plan:    SubscriptionPlan{Title: "Developer", PriceAmount: 2.5, Currency: "USD", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true, AllowBalancePay: &allow, AllowWalletOverflow: &allow, TotalAmount: 1000},
	}
}

func createPlatformSubscriptionUser(t *testing.T, quota int) User {
	t.Helper()
	user := User{Username: "subscription-user", Password: "password-hash", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Quota: quota, AffCode: "subscription-user-aff"}
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func TestPlatformSubscriptionMigrationAndSeedAreIdempotent(t *testing.T) {
	db := setupPlatformSubscriptionTestDB(t)
	require.NoError(t, db.AutoMigrate(&PlatformSubscriptionPlanProfile{}, &PlatformSubscriptionLifecycle{}, &PlatformSubscriptionEvent{}, &PlatformSubscriptionRequest{}))
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer-preview")}))
	require.NoError(t, db.Model(&PlatformSubscriptionPlanProfile{}).Where("plan_key = ?", "developer-preview").Update("name_en", "Operator edit").Error)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer-preview")}))
	var profiles int64
	require.NoError(t, db.Model(&PlatformSubscriptionPlanProfile{}).Count(&profiles).Error)
	assert.Equal(t, int64(1), profiles)
	var profile PlatformSubscriptionPlanProfile
	require.NoError(t, db.Where("plan_key = ?", "developer-preview").First(&profile).Error)
	assert.Equal(t, "Operator edit", profile.NameEn)
	assert.True(t, db.Migrator().HasTable(&PlatformSubscriptionEvent{}))
	assert.True(t, db.Migrator().HasConstraint(&PlatformSubscriptionPlanProfile{}, "chk_platform_plan_visibility"))
	assert.True(t, db.Migrator().HasConstraint(&PlatformSubscriptionPlanProfile{}, "chk_platform_plan_state"))
	assert.True(t, db.Migrator().HasConstraint(&PlatformSubscriptionLifecycle{}, "chk_platform_subscription_state"))
	duplicate := platformSubscriptionSeed("developer-preview")
	duplicate.Profile.PlanId = profile.PlanId
	assert.Error(t, db.Create(&duplicate.Profile).Error)
}

func TestPlatformPlanPublicFilteringAndMarkupValidation(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	public := platformSubscriptionSeed("public")
	private := platformSubscriptionSeed("private")
	private.Profile.Visibility = "private"
	archived := platformSubscriptionSeed("archived")
	archived.Profile.LifecycleState = PlatformPlanStateDraft
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{public, private, archived}))
	var archivedProfile PlatformSubscriptionPlanProfile
	require.NoError(t, DB.Where("plan_key = ?", "archived").First(&archivedProfile).Error)
	require.NoError(t, ArchivePlatformPlan(archivedProfile.Id))
	plans, err := ListPublicPlatformPlans()
	require.NoError(t, err)
	require.Len(t, plans, 1)
	assert.Equal(t, "public", plans[0].Profile.PlanKey)
	xss := platformSubscriptionSeed("xss")
	xss.Profile.DescriptionEn = "<script>alert(1)</script>"
	assert.ErrorContains(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{xss}), "must not contain HTML")
	invalid := platformSubscriptionSeed("invalid-duration")
	invalid.Plan.DurationUnit = "fortnight"
	assert.ErrorContains(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{invalid}), "invalid duration_unit")
}

func TestPlatformSubscriptionPurchaseIsIdempotentAndSnapshotsPrice(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	user := createPlatformSubscriptionUser(t, 1000)

	first, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "purchase-1")
	require.NoError(t, err)
	second, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "purchase-1")
	require.NoError(t, err)
	assert.Equal(t, first.Subscription.Id, second.Subscription.Id)
	assert.Equal(t, "2.500000", first.Lifecycle.PriceSnapshot)

	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, 750, updated.Quota)
	var subscriptionCount, orderCount, eventCount int64
	require.NoError(t, DB.Model(&UserSubscription{}).Count(&subscriptionCount).Error)
	require.NoError(t, DB.Model(&SubscriptionOrder{}).Count(&orderCount).Error)
	require.NoError(t, DB.Model(&PlatformSubscriptionEvent{}).Count(&eventCount).Error)
	assert.Equal(t, int64(1), subscriptionCount)
	assert.Equal(t, int64(1), orderCount)
	assert.Equal(t, int64(4), eventCount)
}

func TestPlatformSubscriptionIdempotencyRejectsDifferentRequest(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer"), platformSubscriptionSeed("team")}))
	user := createPlatformSubscriptionUser(t, 1000)
	_, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "same-key")
	require.NoError(t, err)
	_, err = PurchasePlatformSubscriptionWithBalance(user.Id, "team", "same-key")
	assert.ErrorContains(t, err, "different request")
}

func TestPlatformSubscriptionInsufficientBalanceRollsBack(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	user := createPlatformSubscriptionUser(t, 249)
	_, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "insufficient")
	assert.ErrorContains(t, err, "insufficient")
	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, 249, updated.Quota)
	for _, target := range []interface{}{&UserSubscription{}, &SubscriptionOrder{}, &PlatformSubscriptionLifecycle{}, &PlatformSubscriptionRequest{}} {
		var count int64
		require.NoError(t, DB.Model(target).Count(&count).Error)
		assert.Zero(t, count)
	}
}

func TestPlatformSubscriptionPurchaseRejectsNonPublicPlanAndCrossUserReads(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	seed := platformSubscriptionSeed("private-product")
	seed.Profile.Visibility = "private"
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{seed}))
	owner := createPlatformSubscriptionUser(t, 1000)
	_, err := PurchasePlatformSubscriptionWithBalance(owner.Id, "private-product", "private-purchase")
	assert.Error(t, err)

	require.NoError(t, DB.Model(&PlatformSubscriptionPlanProfile{}).Where("plan_key = ?", "private-product").Update("visibility", "public").Error)
	purchased, err := PurchasePlatformSubscriptionWithBalance(owner.Id, "private-product", "public-purchase")
	require.NoError(t, err)
	other := User{Username: "other-subscription-user", Password: "password-hash", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "other-subscription-aff"}
	require.NoError(t, DB.Create(&other).Error)
	_, err = GetPlatformSubscription(purchased.Subscription.Id, other.Id)
	assert.Error(t, err)
	_, err = ListPlatformSubscriptionEvents(purchased.Subscription.Id, other.Id)
	assert.Error(t, err)
}

func TestPlatformSubscriptionConcurrentIdempotencyDoesNotDoubleCharge(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	user := createPlatformSubscriptionUser(t, 1000)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, errs[index] = PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "concurrent")
		}(i)
	}
	wg.Wait()
	// SQLite may report a transient table lock for one contender; retrying the
	// same key must resolve to the committed request without another charge.
	_, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "concurrent")
	require.NoError(t, err)
	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, 750, updated.Quota)
	var subscriptions, orders int64
	require.NoError(t, DB.Model(&UserSubscription{}).Count(&subscriptions).Error)
	require.NoError(t, DB.Model(&SubscriptionOrder{}).Count(&orders).Error)
	assert.Equal(t, int64(1), subscriptions)
	assert.Equal(t, int64(1), orders)
}

func TestPlatformSubscriptionCancelAtEndThenImmediateRevoke(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	user := createPlatformSubscriptionUser(t, 1000)
	purchased, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "cancel-purchase")
	require.NoError(t, err)

	canceling, err := CancelPlatformSubscription(purchased.Subscription.Id, user.Id, false, "user", user.Id, "")
	require.NoError(t, err)
	assert.Equal(t, PlatformSubscriptionStateCanceling, canceling.Lifecycle.LifecycleState)
	assert.Equal(t, "active", canceling.Subscription.Status)
	assert.True(t, canceling.Lifecycle.CancelAtPeriodEnd)

	resumed, err := RevokePlatformSubscriptionCancellation(purchased.Subscription.Id, user.Id)
	require.NoError(t, err)
	assert.Equal(t, PlatformSubscriptionStateActive, resumed.Lifecycle.LifecycleState)
	assert.False(t, resumed.Lifecycle.CancelAtPeriodEnd)

	canceled, err := CancelPlatformSubscription(purchased.Subscription.Id, 0, true, "admin", 99, "policy enforcement")
	require.NoError(t, err)
	assert.Equal(t, PlatformSubscriptionStateCanceled, canceled.Lifecycle.LifecycleState)
	assert.Equal(t, "cancelled", canceled.Subscription.Status)
	assert.False(t, canceled.Entitlements["active"].(bool))
}

func TestPlatformSubscriptionRenewalChargesOnceAndExtendsPeriod(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	user := createPlatformSubscriptionUser(t, 1000)
	purchased, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "renew-purchase")
	require.NoError(t, err)
	oldEnd := purchased.Subscription.EndTime

	renewed, err := RenewPlatformSubscriptionWithBalance(purchased.Subscription.Id, user.Id, "renew-1", "user", user.Id)
	require.NoError(t, err)
	again, err := RenewPlatformSubscriptionWithBalance(purchased.Subscription.Id, user.Id, "renew-1", "user", user.Id)
	require.NoError(t, err)
	assert.Equal(t, renewed.Subscription.EndTime, again.Subscription.EndTime)
	assert.Greater(t, renewed.Subscription.EndTime, oldEnd)
	assert.EqualValues(t, 2000, renewed.Subscription.AmountTotal)
	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, 500, updated.Quota)
	var orderCount int64
	require.NoError(t, DB.Model(&SubscriptionOrder{}).Count(&orderCount).Error)
	assert.Equal(t, int64(2), orderCount)
}

func TestPlatformSubscriptionConcurrentRenewalDoesNotDoubleCharge(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	user := createPlatformSubscriptionUser(t, 1000)
	purchased, err := PurchasePlatformSubscriptionWithBalance(user.Id, "developer", "concurrent-renew-purchase")
	require.NoError(t, err)

	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = RenewPlatformSubscriptionWithBalance(purchased.Subscription.Id, user.Id, "concurrent-renew", "user", user.Id)
		}()
	}
	wg.Wait()
	_, err = RenewPlatformSubscriptionWithBalance(purchased.Subscription.Id, user.Id, "concurrent-renew", "user", user.Id)
	require.NoError(t, err)

	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, 500, updated.Quota)
	var orders int64
	require.NoError(t, DB.Model(&SubscriptionOrder{}).Count(&orders).Error)
	assert.Equal(t, int64(2), orders)
}

func TestPlatformSubscriptionRenewalRejectsOversizedIdempotencyKey(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	_, err := RenewPlatformSubscriptionWithBalance(1, 1, strings.Repeat("x", 129), "user", 1)
	assert.ErrorContains(t, err, "Idempotency-Key")
}

func TestPlatformSubscriptionAutomaticRenewalAndFailureBoundary(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	successUser := createPlatformSubscriptionUser(t, 1000)
	success, err := PurchasePlatformSubscriptionWithBalance(successUser.Id, "developer", "auto-success-purchase")
	require.NoError(t, err)
	_, err = SetPlatformSubscriptionAutoRenew(success.Subscription.Id, successUser.Id, true)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", success.Subscription.Id).Updates(map[string]interface{}{"end_time": GetDBTimestamp() - 1, "amount_used": 400}).Error)
	processed, err := ProcessDuePlatformSubscriptionRenewals(10)
	require.NoError(t, err)
	assert.Equal(t, 1, processed)
	renewed, err := GetPlatformSubscription(success.Subscription.Id, successUser.Id)
	require.NoError(t, err)
	assert.Equal(t, PlatformSubscriptionStateActive, renewed.Lifecycle.LifecycleState)
	assert.Greater(t, renewed.Subscription.EndTime, GetDBTimestamp())
	assert.EqualValues(t, 1000, renewed.Subscription.AmountTotal)
	assert.Zero(t, renewed.Subscription.AmountUsed)

	failureUser := User{Username: "subscription-failure-user", Password: "password-hash", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Quota: 250, AffCode: "subscription-failure-aff"}
	require.NoError(t, DB.Create(&failureUser).Error)
	failure, err := PurchasePlatformSubscriptionWithBalance(failureUser.Id, "developer", "auto-failure-purchase")
	require.NoError(t, err)
	_, err = SetPlatformSubscriptionAutoRenew(failure.Subscription.Id, failureUser.Id, true)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", failure.Subscription.Id).Update("end_time", GetDBTimestamp()-1).Error)
	processed, err = ProcessDuePlatformSubscriptionRenewals(10)
	require.NoError(t, err)
	assert.Equal(t, 1, processed)
	failed, err := GetPlatformSubscription(failure.Subscription.Id, failureUser.Id)
	require.NoError(t, err)
	assert.Equal(t, PlatformSubscriptionStateRenewalFailed, failed.Lifecycle.LifecycleState)
	assert.False(t, failed.Lifecycle.AutoRenew)
	assert.Contains(t, failed.Lifecycle.RenewalFailure, "insufficient")
	var failedEvents int64
	require.NoError(t, DB.Model(&PlatformSubscriptionEvent{}).Where("user_subscription_id = ? AND event_type = ?", failure.Subscription.Id, "failed").Count(&failedEvents).Error)
	assert.Equal(t, int64(1), failedEvents)
}

func TestPlatformPlanArchivePreservesFinancialRecords(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("developer")}))
	plans, err := ListAdminPlatformPlans()
	require.NoError(t, err)
	require.Len(t, plans, 1)
	require.NoError(t, ArchivePlatformPlan(plans[0].Profile.Id))
	archived, err := GetAdminPlatformPlan(plans[0].Profile.Id)
	require.NoError(t, err)
	assert.Equal(t, PlatformPlanStateArchived, archived.Profile.LifecycleState)
	assert.False(t, archived.Plan.Enabled)
	_, err = AdminDeleteUserSubscription(1)
	assert.ErrorContains(t, err, "immutable")
}

func TestPlatformSubscriptionGroupFallbackUsesRemainingSourceAndPreservesAdminOverride(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	user := createPlatformSubscriptionUser(t, 0)
	now := GetDBTimestamp()
	premium := UserSubscription{UserId: user.Id, PlanId: 1, Status: "active", EndTime: now + 100, UpgradeGroup: "premium", PrevUserGroup: "default"}
	enterprise := UserSubscription{UserId: user.Id, PlanId: 2, Status: "active", EndTime: now + 200, UpgradeGroup: "enterprise", PrevUserGroup: "premium"}
	require.NoError(t, DB.Create(&premium).Error)
	require.NoError(t, DB.Create(&enterprise).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("group", "enterprise").Error)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		target, err := downgradeUserGroupForSubscriptionTx(tx, &enterprise, now)
		assert.Equal(t, "premium", target)
		return err
	}))
	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "premium", updated.Group)

	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", enterprise.Id).Update("status", "expired").Error)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		target, err := downgradeUserGroupForSubscriptionTx(tx, &premium, now+150)
		assert.Equal(t, "default", target)
		return err
	}))
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "default", updated.Group)

	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("group", "admin-grant").Error)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		target, err := downgradeUserGroupForSubscriptionTx(tx, &premium, now+150)
		assert.Empty(t, target)
		return err
	}))
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "admin-grant", updated.Group)
}

func TestPlatformPlanUpdatePreservesIdentityAndCreationAudit(t *testing.T) {
	setupPlatformSubscriptionTestDB(t)
	require.NoError(t, SeedPlatformSubscriptionPlans([]PlatformSubscriptionPlanSeed{platformSubscriptionSeed("stable-key")}))
	plans, err := ListAdminPlatformPlans()
	require.NoError(t, err)
	require.Len(t, plans, 1)
	before := plans[0]
	before.Profile.PlanKey = "changed-key"
	_, err = UpsertPlatformPlan(before.Profile, before.Plan)
	assert.ErrorContains(t, err, "immutable")

	before.Profile.PlanKey = "stable-key"
	before.Profile.CreatedAt = 1
	before.Plan.CreatedAt = 1
	before.Plan.PriceAmount = 3.5
	updated, err := UpsertPlatformPlan(before.Profile, before.Plan)
	require.NoError(t, err)
	assert.Equal(t, "stable-key", updated.Profile.PlanKey)
	assert.NotEqualValues(t, 1, updated.Profile.CreatedAt)
	assert.NotEqualValues(t, 1, updated.Plan.CreatedAt)
	assert.Equal(t, 3.5, updated.Plan.PriceAmount)
}
