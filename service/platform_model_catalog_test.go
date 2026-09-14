package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPlatformCatalogServiceTest(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := model.DB
	previousRedis := common.RedisEnabled
	previousType := common.MainDatabaseType()
	oldModelRatios := ratio_setting.GetModelRatioCopy()
	oldCompletionRatios := ratio_setting.GetCompletionRatioCopy()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PlatformModelCatalog{}, &model.Channel{}, &model.Ability{}))
	model.DB = db
	common.RedisEnabled = false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	InvalidatePlatformModelCatalogCache()
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedis
		common.SetMainDatabaseType(previousType)
		modelJSON, _ := common.Marshal(oldModelRatios)
		completionJSON, _ := common.Marshal(oldCompletionRatios)
		_ = ratio_setting.UpdateModelRatioByJSONString(string(modelJSON))
		_ = ratio_setting.UpdateCompletionRatioByJSONString(string(completionJSON))
		model.InvalidatePricingCache()
		InvalidatePlatformModelCatalogCache()
		_ = sqlDB.Close()
	})
	return db
}

func serviceCatalogEntry(id string) model.PlatformModelCatalog {
	return model.PlatformModelCatalog{
		PublicModelID: id, DisplayName: "Service Model", ProviderKey: "platform", ProviderLabel: "Platform routing",
		DescriptionEN: "English description", DescriptionZhCN: "中文描述", Category: "general",
		Capabilities: model.JSONStringList{"chat"}, InputModalities: model.JSONStringList{"text"}, OutputModalities: model.JSONStringList{"text"},
		IconKey: "platform", BadgeKey: "preview", AvailabilityStatus: model.PlatformModelAvailabilityPreview,
		Visibility: model.PlatformModelVisibilityPublic, ShowInPricing: true, ShowInPlayground: true, APIEnabled: true, SortOrder: 1,
	}
}

func TestPlatformDescriptionSelectsLocale(t *testing.T) {
	entry := serviceCatalogEntry("platform-locale-preview")
	assert.Equal(t, "English description", platformDescription(entry, "en-US"))
	assert.Equal(t, "中文描述", platformDescription(entry, "zh-CN"))
}

func TestAggregatePlatformPricingUsesExistingPriceTruthAndRouteDiagnostics(t *testing.T) {
	db := setupPlatformCatalogServiceTest(t)
	entry := serviceCatalogEntry("platform-priced-preview")
	require.NoError(t, db.Create(&entry).Error)
	priority := int64(0)
	require.NoError(t, db.Create(&model.Channel{Id: 1, Name: "route", Status: common.ChannelStatusEnabled, Key: "redacted"}).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "default", Model: entry.PublicModelID, ChannelId: 1, Enabled: true, Priority: &priority}).Error)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"platform-priced-preview":0.4}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"platform-priced-preview":2}`))

	result, err := AggregatePlatformPricing([]model.Pricing{{ModelName: entry.PublicModelID, ModelRatio: 0.4, CompletionRatio: 2, EnableGroup: []string{"default"}}}, "zh-CN", "")
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "Service Model", result[0].DisplayName)
	assert.Equal(t, "platform", result[0].ProviderKey)
	assert.Equal(t, "中文描述", result[0].Description)
	assert.Equal(t, 0.4, result[0].ModelRatio)
	assert.Equal(t, "configured", result[0].PlatformPricingStatus)
	assert.Equal(t, "available", result[0].RouteAvailability)
}

func TestPublicPlatformModelExposesProviderKey(t *testing.T) {
	db := setupPlatformCatalogServiceTest(t)
	entry := serviceCatalogEntry("platform-provider-key-preview")
	entry.ProviderKey = "openai"
	require.NoError(t, db.Create(&entry).Error)

	public, err := publicPlatformModel(entry, "en", "", map[string]model.Pricing{})
	require.NoError(t, err)
	assert.Equal(t, "openai", public.ProviderKey)
}

func TestPublicPlatformModelExposesDocumentedPromptCacheMetadata(t *testing.T) {
	db := setupPlatformCatalogServiceTest(t)
	documented := serviceCatalogEntry("claude-opus-5")
	unknown := serviceCatalogEntry("claude-3-haiku")
	require.NoError(t, db.Create(&documented).Error)
	require.NoError(t, db.Create(&unknown).Error)

	publicDocumented, err := publicPlatformModel(documented, "en", "", map[string]model.Pricing{})
	require.NoError(t, err)
	require.NotNil(t, publicDocumented.PromptCache)
	assert.Equal(t, 512, publicDocumented.PromptCache.MinimumTokens)
	assert.Equal(t, promptCacheSourceAnthropicDocs, publicDocumented.PromptCache.Source)
	assert.Equal(t, promptCacheCheckedAt, publicDocumented.PromptCache.CheckedAt)

	publicUnknown, err := publicPlatformModel(unknown, "en", "", map[string]model.Pricing{})
	require.NoError(t, err)
	assert.Nil(t, publicUnknown.PromptCache)
}

func TestPromptCacheInfoUsesCurrentAnthropicOpusValues(t *testing.T) {
	testCases := []struct {
		publicModelID string
		minimumTokens int
	}{
		{publicModelID: "claude-opus-4.7", minimumTokens: 2048},
		{publicModelID: "claude-opus-4.8", minimumTokens: 1024},
	}

	for _, testCase := range testCases {
		t.Run(testCase.publicModelID, func(t *testing.T) {
			info := promptCacheInfo(testCase.publicModelID)
			require.NotNil(t, info)
			assert.Equal(t, testCase.minimumTokens, info.MinimumTokens)
			assert.Equal(t, promptCacheSourceAnthropicDocs, info.Source)
		})
	}
}

func TestAggregatePlatformPricingCarriesContextTokens(t *testing.T) {
	db := setupPlatformCatalogServiceTest(t)
	entry := serviceCatalogEntry("platform-context-tokens-preview")
	entry.ContextTokens = 128_000
	require.NoError(t, db.Create(&entry).Error)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"platform-context-tokens-preview":0.4}`))

	result, err := AggregatePlatformPricing(nil, "en", "")
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, 128_000, result[0].ContextTokens)
}

func TestAggregatePlatformPricingMakesMissingPriceExplicit(t *testing.T) {
	db := setupPlatformCatalogServiceTest(t)
	entry := serviceCatalogEntry("platform-no-price-preview")
	require.NoError(t, db.Create(&entry).Error)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{}`))

	result, err := AggregatePlatformPricing(nil, "en", "")
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "unavailable", result[0].PlatformPricingStatus)
	assert.Equal(t, "no_active_route", result[0].RouteAvailability)
}

func TestPlatformCatalogCacheInvalidatesAfterMutation(t *testing.T) {
	db := setupPlatformCatalogServiceTest(t)
	entry := serviceCatalogEntry("platform-cache-preview")
	require.NoError(t, model.ValidatePlatformModelCatalog(&entry))
	require.NoError(t, model.CreatePlatformModelCatalog(&entry))
	InvalidatePlatformModelCatalogCache()
	first, err := listCachedPlatformCatalog()
	require.NoError(t, err)
	assert.Equal(t, "Service Model", first[0].DisplayName)

	require.NoError(t, db.Model(&model.PlatformModelCatalog{}).Where("id = ?", entry.ID).Update("display_name", "Direct database edit").Error)
	cached, err := listCachedPlatformCatalog()
	require.NoError(t, err)
	assert.Equal(t, "Service Model", cached[0].DisplayName)

	InvalidatePlatformModelCatalogCache()
	refreshed, err := listCachedPlatformCatalog()
	require.NoError(t, err)
	assert.Equal(t, "Direct database edit", refreshed[0].DisplayName)
}
