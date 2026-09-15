package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupReleaseTest(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PlatformModelCatalog{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		_ = sqlDB.Close()
	})
	return db
}

func syncOwnedDraftRow(publicModelID string, apiEnabled bool) model.PlatformModelCatalog {
	return model.PlatformModelCatalog{
		PublicModelID: publicModelID, DisplayName: publicModelID, ProviderKey: "openai", ProviderLabel: "OpenAI",
		DescriptionEN: "english", DescriptionZhCN: "english", Category: "general",
		Capabilities: model.JSONStringList{"chat"}, InputModalities: model.JSONStringList{"text"}, OutputModalities: model.JSONStringList{"text"},
		IconKey: "platform", AvailabilityStatus: model.PlatformModelAvailabilityPreview, Visibility: model.PlatformModelVisibilityHidden,
		APIEnabled: apiEnabled, SyncSource: openRouterSyncSource, SyncBatchID: "batch-1",
	}
}

func TestReleasePlatformModelsFlipsVisibilityAndOptionallyAPIEnabled(t *testing.T) {
	setupReleaseTest(t)
	draft := syncOwnedDraftRow("gpt-4o", false)
	require.NoError(t, model.CreatePlatformModelCatalog(&draft))
	alreadyPriced := syncOwnedDraftRow("gemini-2.5-pro", true)
	require.NoError(t, model.CreatePlatformModelCatalog(&alreadyPriced))

	result, err := ReleasePlatformModels([]ReleaseCandidate{
		{PublicModelID: "gpt-4o", EnableAPI: true},
		{PublicModelID: "gemini-2.5-pro", EnableAPI: false},
	})
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"gpt-4o", "gemini-2.5-pro"}, result.Released)
	assert.Empty(t, result.SkippedForeign)
	assert.Empty(t, result.SkippedMissing)
	assert.Empty(t, result.Failed)

	gpt4o, err := model.GetPlatformModelCatalogByPublicID("gpt-4o")
	require.NoError(t, err)
	assert.Equal(t, model.PlatformModelVisibilityPublic, gpt4o.Visibility)
	assert.True(t, gpt4o.APIEnabled)
	assert.Equal(t, model.PlatformModelAvailabilityAvailable, gpt4o.AvailabilityStatus)

	gemini, err := model.GetPlatformModelCatalogByPublicID("gemini-2.5-pro")
	require.NoError(t, err)
	assert.Equal(t, model.PlatformModelVisibilityPublic, gemini.Visibility)
	assert.True(t, gemini.APIEnabled, "was already true; EnableAPI:false must not turn it off")
}

func TestReleasePlatformModelsSkipsForeignRow(t *testing.T) {
	setupReleaseTest(t)
	foreign := model.PlatformModelCatalog{
		PublicModelID: "claude-opus-4.6", DisplayName: "Claude Opus 4.6", ProviderKey: "platform", ProviderLabel: "HYC AI",
		DescriptionEN: "english", DescriptionZhCN: "english", Category: "general",
		Capabilities: model.JSONStringList{"chat"}, InputModalities: model.JSONStringList{"text"}, OutputModalities: model.JSONStringList{"text"},
		IconKey: "brain", AvailabilityStatus: model.PlatformModelAvailabilityPreview, Visibility: model.PlatformModelVisibilityPublic,
		APIEnabled: true, // SyncSource left empty: not created by this sync.
	}
	require.NoError(t, model.CreatePlatformModelCatalog(&foreign))

	result, err := ReleasePlatformModels([]ReleaseCandidate{{PublicModelID: "claude-opus-4.6", EnableAPI: true}})
	require.NoError(t, err)
	assert.Empty(t, result.Released)
	assert.Contains(t, result.SkippedForeign, "claude-opus-4.6")

	unchanged, err := model.GetPlatformModelCatalogByPublicID("claude-opus-4.6")
	require.NoError(t, err)
	assert.Equal(t, model.PlatformModelAvailabilityPreview, unchanged.AvailabilityStatus, "a foreign row must not even get its availability_status recomputed")
}

func TestReleasePlatformModelsSkipsMissingID(t *testing.T) {
	setupReleaseTest(t)
	result, err := ReleasePlatformModels([]ReleaseCandidate{{PublicModelID: "does-not-exist", EnableAPI: true}})
	require.NoError(t, err)
	assert.Empty(t, result.Released)
	assert.Contains(t, result.SkippedMissing, "does-not-exist")
}

func TestReleasePlatformModelsSetsAvailabilityStatusPerUpstreamLifecycle(t *testing.T) {
	setupReleaseTest(t)
	preview := syncOwnedDraftRow("gemini-3-flash-preview", false)
	require.NoError(t, model.CreatePlatformModelCatalog(&preview))

	_, err := ReleasePlatformModels([]ReleaseCandidate{{PublicModelID: "gemini-3-flash-preview", EnableAPI: true}})
	require.NoError(t, err)

	entry, err := model.GetPlatformModelCatalogByPublicID("gemini-3-flash-preview")
	require.NoError(t, err)
	assert.Equal(t, model.PlatformModelAvailabilityPreview, entry.AvailabilityStatus, "a genuine upstream preview id must stay preview through release, not flip to available")
}
