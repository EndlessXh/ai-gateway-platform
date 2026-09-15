package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPlatformModelCatalogTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := DB
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	initCol()
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		initCol()
		_ = sqlDB.Close()
	})
	return db
}

func validPlatformCatalogEntry(id string) PlatformModelCatalog {
	return PlatformModelCatalog{
		PublicModelID:      id,
		DisplayName:        "Platform Test",
		ProviderKey:        "platform",
		ProviderLabel:      "Platform routing",
		DescriptionEN:      "English product description.",
		DescriptionZhCN:    "中文产品描述。",
		Category:           "general",
		Capabilities:       JSONStringList{"chat", "streaming"},
		InputModalities:    JSONStringList{"text"},
		OutputModalities:   JSONStringList{"text"},
		IconKey:            "platform",
		BadgeKey:           "preview",
		AvailabilityStatus: PlatformModelAvailabilityPreview,
		Visibility:         PlatformModelVisibilityPublic,
		ShowInPricing:      true,
		ShowInPlayground:   true,
		APIEnabled:         true,
		SortOrder:          10,
	}
}

func TestPlatformModelCatalogMigrationAndUniqueConstraint(t *testing.T) {
	db := setupPlatformModelCatalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&PlatformModelCatalog{}))
	require.NoError(t, db.AutoMigrate(&PlatformModelCatalog{}))
	assert.True(t, db.Migrator().HasTable(&PlatformModelCatalog{}))
	assert.True(t, db.Migrator().HasIndex(&PlatformModelCatalog{}, "idx_platform_model_catalog_public_id"))

	first := validPlatformCatalogEntry("platform-test-preview")
	require.NoError(t, db.Create(&first).Error)
	duplicate := validPlatformCatalogEntry("platform-test-preview")
	assert.Error(t, db.Create(&duplicate).Error)
}

func TestPlatformModelCatalogRejectsInvalidStateAndMarkup(t *testing.T) {
	db := setupPlatformModelCatalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&PlatformModelCatalog{}))

	invalidState := validPlatformCatalogEntry("platform-invalid-state")
	invalidState.AvailabilityStatus = "online-ish"
	assert.ErrorContains(t, CreatePlatformModelCatalog(&invalidState), "invalid availability_status")

	xss := validPlatformCatalogEntry("platform-xss-preview")
	xss.DescriptionEN = "<script>alert(1)</script>"
	assert.ErrorContains(t, CreatePlatformModelCatalog(&xss), "must not contain HTML")

	invalidCapability := validPlatformCatalogEntry("platform-invalid-capability")
	invalidCapability.Capabilities = JSONStringList{"chat", "arbitrary_json"}
	assert.ErrorContains(t, CreatePlatformModelCatalog(&invalidCapability), "invalid capabilities")
}

func TestSeedPlatformModelCatalogIsIdempotentAndPreservesEdits(t *testing.T) {
	db := setupPlatformModelCatalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&PlatformModelCatalog{}))
	seed := []PlatformModelCatalog{validPlatformCatalogEntry("platform-seed-preview")}
	require.NoError(t, SeedPlatformModelCatalog(seed))
	require.NoError(t, db.Model(&PlatformModelCatalog{}).Where("public_model_id = ?", "platform-seed-preview").Update("display_name", "Administrator edit").Error)
	require.NoError(t, SeedPlatformModelCatalog(seed))

	var count int64
	require.NoError(t, db.Model(&PlatformModelCatalog{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
	entry, err := GetPlatformModelCatalogByPublicID("platform-seed-preview")
	require.NoError(t, err)
	assert.Equal(t, "Administrator edit", entry.DisplayName)
}

func TestPlatformModelCatalogValidatesContextTokensBounds(t *testing.T) {
	cases := []struct {
		name    string
		tokens  int
		wantErr string
	}{
		{name: "zero is unknown and allowed", tokens: 0},
		{name: "typical value", tokens: 128_000},
		{name: "at max boundary", tokens: 100_000_000},
		{name: "negative rejected", tokens: -1, wantErr: "context_tokens must be between 0 and 100000000"},
		{name: "above max rejected", tokens: 100_000_001, wantErr: "context_tokens must be between 0 and 100000000"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entry := validPlatformCatalogEntry("platform-context-tokens-preview")
			entry.ContextTokens = tc.tokens
			err := ValidatePlatformModelCatalog(&entry)
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			assert.ErrorContains(t, err, tc.wantErr)
		})
	}
}

func TestPlatformModelCatalogPersistsContextTokens(t *testing.T) {
	db := setupPlatformModelCatalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&PlatformModelCatalog{}))
	entry := validPlatformCatalogEntry("platform-context-persist-preview")
	entry.ContextTokens = 200_000
	require.NoError(t, CreatePlatformModelCatalog(&entry))

	fetched, err := GetPlatformModelCatalogByPublicID("platform-context-persist-preview")
	require.NoError(t, err)
	assert.Equal(t, 200_000, fetched.ContextTokens)
}

func TestPlatformModelCatalogValidatesSyncFields(t *testing.T) {
	cases := []struct {
		name        string
		syncSource  string
		syncBatchID string
		wantErr     string
	}{
		{name: "both empty is the manually-created default"},
		{name: "valid source and batch id", syncSource: "openrouter", syncBatchID: "20260911-201600"},
		{name: "invalid source rejected", syncSource: "OpenRouter!", wantErr: "sync_source must be empty or a lowercase identifier key"},
		{name: "overlong batch id rejected", syncBatchID: strings.Repeat("a", 65), wantErr: "sync_batch_id must be at most 64 characters"},
		{name: "markup in batch id rejected", syncBatchID: "<script>", wantErr: "must not contain HTML markup"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entry := validPlatformCatalogEntry("platform-sync-fields-preview")
			entry.SyncSource = tc.syncSource
			entry.SyncBatchID = tc.syncBatchID
			err := ValidatePlatformModelCatalog(&entry)
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			assert.ErrorContains(t, err, tc.wantErr)
		})
	}
}

func TestPlatformModelCatalogQueryableBySyncBatch(t *testing.T) {
	db := setupPlatformModelCatalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&PlatformModelCatalog{}))

	batchA := validPlatformCatalogEntry("platform-sync-batch-a-preview")
	batchA.SyncSource = "openrouter"
	batchA.SyncBatchID = "batch-a"
	require.NoError(t, CreatePlatformModelCatalog(&batchA))

	batchB := validPlatformCatalogEntry("platform-sync-batch-b-preview")
	batchB.SyncSource = "openrouter"
	batchB.SyncBatchID = "batch-b"
	require.NoError(t, CreatePlatformModelCatalog(&batchB))

	manual := validPlatformCatalogEntry("platform-sync-manual-preview")
	require.NoError(t, CreatePlatformModelCatalog(&manual))

	var batchAOnly []PlatformModelCatalog
	require.NoError(t, db.Where("sync_source = ? AND sync_batch_id = ?", "openrouter", "batch-a").Find(&batchAOnly).Error)
	require.Len(t, batchAOnly, 1)
	assert.Equal(t, "platform-sync-batch-a-preview", batchAOnly[0].PublicModelID)

	var manuallyCreated []PlatformModelCatalog
	require.NoError(t, db.Where("sync_source = ?", "").Find(&manuallyCreated).Error)
	require.Len(t, manuallyCreated, 1)
	assert.Equal(t, "platform-sync-manual-preview", manuallyCreated[0].PublicModelID)
}

func TestUpdatePlatformModelCatalogDoesNotAutoPreserveSyncFields(t *testing.T) {
	// UpdatePlatformModelCatalog does a full-row Save. It only carries CreatedAt
	// forward automatically; every other field, including SyncSource/SyncBatchID,
	// is whatever the caller passed in. A sync tool that updates an existing row
	// MUST read the existing SyncSource/SyncBatchID first and copy them onto the
	// entry it saves, or it will either wipe a prior batch tag or (worse) stamp
	// its own source onto a row it didn't create. This test pins that contract.
	db := setupPlatformModelCatalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&PlatformModelCatalog{}))
	entry := validPlatformCatalogEntry("platform-sync-update-preview")
	entry.SyncSource = "openrouter"
	entry.SyncBatchID = "batch-original"
	require.NoError(t, CreatePlatformModelCatalog(&entry))

	update := entry
	update.SyncSource = ""
	update.SyncBatchID = ""
	require.NoError(t, UpdatePlatformModelCatalog(&update))

	fetched, err := GetPlatformModelCatalogByPublicID("platform-sync-update-preview")
	require.NoError(t, err)
	assert.Empty(t, fetched.SyncSource, "Save overwrote SyncSource because the caller did not carry it forward")
	assert.Empty(t, fetched.SyncBatchID, "Save overwrote SyncBatchID because the caller did not carry it forward")
}

func TestPlatformModelRouteSummaryUsesEnabledChannelsAndGroups(t *testing.T) {
	db := setupPlatformModelCatalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}))
	require.NoError(t, db.Create(&Channel{Id: 1, Name: "enabled", Status: common.ChannelStatusEnabled, Key: "redacted"}).Error)
	require.NoError(t, db.Create(&Channel{Id: 2, Name: "disabled", Status: common.ChannelStatusManuallyDisabled, Key: "redacted"}).Error)
	priority := int64(0)
	require.NoError(t, db.Create(&Ability{Group: "default", Model: "platform-route-preview", ChannelId: 1, Enabled: true, Priority: &priority}).Error)
	require.NoError(t, db.Create(&Ability{Group: "other", Model: "platform-route-preview", ChannelId: 2, Enabled: true, Priority: &priority}).Error)

	summary, err := GetPlatformModelRouteSummary("platform-route-preview", map[string]string{"default": "Default"})
	require.NoError(t, err)
	assert.Equal(t, 1, summary.ActiveRouteCount)
	assert.Equal(t, 1, summary.AccessibleRouteCount)
}
