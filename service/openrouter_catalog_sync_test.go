package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/glebarez/sqlite"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func loadFixtureModels(t *testing.T) []openRouterModel {
	t.Helper()
	raw, err := os.ReadFile("testdata/openrouter_models_fixture.json")
	require.NoError(t, err)
	var parsed openRouterModelsResponse
	require.NoError(t, common.Unmarshal(raw, &parsed))
	return parsed.Data
}

func TestDeriveCandidatesFiltersAndTransformsFixture(t *testing.T) {
	models := loadFixtureModels(t)
	candidates, skippedAlias, skippedBatch, skippedFree, skippedUnparsable := deriveCandidates(models)

	assert.Equal(t, 1, skippedAlias, "the ~openai/gpt-astra-latest pointer must be excluded")
	assert.Equal(t, 1, skippedBatch, "the openai/gpt-6-astra:batch variant must be excluded")
	assert.Zero(t, skippedFree)
	assert.Empty(t, skippedUnparsable)
	require.Len(t, candidates, 5)

	byID := make(map[string]catalogCandidate, len(candidates))
	for _, c := range candidates {
		byID[c.PublicModelID] = c
	}

	gpt4oMini, ok := byID["gpt-4o-mini"]
	require.True(t, ok, "vendor prefix must be stripped when there is no collision")
	assert.Equal(t, "GPT-4o-mini", gpt4oMini.DisplayName)
	assert.Equal(t, "openai", gpt4oMini.ProviderKey)
	assert.Equal(t, "OpenAI", gpt4oMini.ProviderLabel)
	assert.Equal(t, 128000, gpt4oMini.ContextTokens)
	assert.Equal(t, "128K context", gpt4oMini.ContextLabel)
	assert.InDelta(t, 0.075, gpt4oMini.ModelRatio, 1e-9)
	assert.InDelta(t, 4.0, gpt4oMini.CompletionRatio, 1e-9)
	assert.Contains(t, gpt4oMini.Capabilities, "vision", "input_modalities includes image")

	haiku, ok := byID["claude-3-haiku"]
	require.True(t, ok)
	assert.Equal(t, "Anthropic", haiku.ProviderLabel)
	assert.Equal(t, "anthropic", haiku.ProviderKey)
	assert.InDelta(t, 0.125, haiku.ModelRatio, 1e-9)

	tiered, ok := byID["fugu-ultra-v2"]
	require.True(t, ok)
	require.NotNil(t, tiered.TieredNote)
	assert.InDelta(t, 2.5, tiered.TieredNote.BaseRatio, 1e-9, "base tier: 0.000005*1000*500=2.5")
	assert.InDelta(t, 5.0, tiered.TieredNote.TopTierRatio, 1e-9, "top tier: 0.00001*1000*500=5")
	assert.Equal(t, 272000, tiered.TieredNote.ThresholdTokens)
	assert.InDelta(t, tiered.ModelRatio, tiered.TieredNote.TopTierRatio, 1e-9, "the candidate itself must be priced at the top tier, not the base rate")

	_, collisionStripped := byID["shared-suffix"]
	assert.False(t, collisionStripped, "a stripped id claimed by two different models must not be used by either")
	vendorA, okA := byID["vendor-a-shared-suffix"]
	vendorB, okB := byID["vendor-b-shared-suffix"]
	require.True(t, okA && okB, "both colliding models must fall back to their full vendor-prefixed id")
	assert.NotEqual(t, vendorA.PublicModelID, vendorB.PublicModelID)
}

func TestDeriveCandidatesExplicitlySkipsFreeTier(t *testing.T) {
	models := []openRouterModel{
		{ID: "acme/example:free"},
		{ID: "openrouter/free"},
		{ID: "google/lyria-3-clip-preview"},
		{ID: "google/lyria-3-pro-preview"},
	}

	candidates, skippedAlias, skippedBatch, skippedFree, skippedUnparsable := deriveCandidates(models)

	assert.Empty(t, candidates)
	assert.Zero(t, skippedAlias)
	assert.Zero(t, skippedBatch)
	assert.Equal(t, 4, skippedFree)
	assert.Empty(t, skippedUnparsable, "free supply is a product-policy skip, not an invalid identifier")
}

func TestConvertRatioEdgeCases(t *testing.T) {
	cases := []struct {
		name               string
		prompt, completion string
		cacheRead          string
		wantOK             bool
		wantModelRatio     float64
		wantHasCacheRatio  bool
	}{
		{name: "normal", prompt: "0.000002", completion: "0.000008", cacheRead: "0.000001", wantOK: true, wantModelRatio: 1, wantHasCacheRatio: true},
		{name: "free model", prompt: "0", completion: "0", wantOK: true, wantModelRatio: 0},
		{name: "negative sentinel skipped", prompt: "-1", completion: "-1", wantOK: false},
		{name: "unparsable skipped", prompt: "not-a-number", completion: "also-not-a-number", wantOK: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			modelRatio, _, _, hasCacheRatio, ok := convertRatio(tc.prompt, tc.completion, tc.cacheRead)
			assert.Equal(t, tc.wantOK, ok)
			if tc.wantOK {
				assert.InDelta(t, tc.wantModelRatio, modelRatio, 1e-9)
			}
			assert.Equal(t, tc.wantHasCacheRatio, hasCacheRatio)
		})
	}
}

func TestParseModalityRejectsUnrecognizedValue(t *testing.T) {
	_, _, err := parseModality([]string{"text", "smell"}, []string{"text"})
	assert.ErrorContains(t, err, "unrecognized modality")
}

// TestSanitizeDescriptionStripsMarkdownLinks pins a real production failure:
// Poolside's live OpenRouter listing wraps its link target in Markdown
// autolink angle brackets ("[Poolside](<https://poolside.ai/>)"), which
// satisfies containsMarkup's "<" check and aborted a real dev sync run
// before this fix.
func TestSanitizeDescriptionStripsMarkdownLinks(t *testing.T) {
	in := "Laguna S 2.1 is the latest coding agent model from [Poolside](<https://poolside.ai/>). It scores well."
	out := sanitizeDescription(in)
	assert.NotContains(t, out, "<")
	assert.NotContains(t, out, ">")
	assert.Contains(t, out, "from Poolside.")
}

func TestSyncOpenRouterCatalogContinuesPastAPerModelValidationFailure(t *testing.T) {
	_, channelID := setupOpenRouterSyncTest(t)
	badFixture := `{"data":[
		{"id":"openai/gpt-4o-mini","name":"OpenAI: GPT-4o-mini","description":"fine","context_length":128000,"architecture":{"modality":"text->text","input_modalities":["text"],"output_modalities":["text"]},"pricing":{"prompt":"0.00000015","completion":"0.0000006"}},
		{"id":"brokenvendor/model1","name":"OpenAI: ","description":"a model whose name has nothing after the vendor label, so display_name derives empty","context_length":8000,"architecture":{"modality":"text->text","input_modalities":["text"],"output_modalities":["text"]},"pricing":{"prompt":"0.000001","completion":"0.000002"}}
	]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(badFixture))
	}))
	defer server.Close()
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Update("base_url", server.URL).Error)

	result, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-1"})
	require.NoError(t, err, "one bad record must not abort the whole batch")
	assert.Contains(t, result.Added, "gpt-4o-mini", "the good record before the bad one must still be written")
	require.Len(t, result.Failed, 1)
	assert.Contains(t, result.Failed[0], "display_name")
}

func setupOpenRouterSyncTest(t *testing.T) (*gorm.DB, int) {
	t.Helper()
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	oldModelRatios := ratio_setting.GetModelRatioCopy()
	oldCompletionRatios := ratio_setting.GetCompletionRatioCopy()
	oldCacheRatios := ratio_setting.GetCacheRatioCopy()
	previousOptionMap := common.OptionMap
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PlatformModelCatalog{}, &model.Channel{}, &model.Option{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	// model.UpdateOption (the sync's real ratio-write path) both saves to the
	// options table and updates common.OptionMap; a real process populates
	// that map at startup via model.InitOptionMap(), which pulls in far more
	// than this test needs, so it is seeded directly here instead.
	common.OptionMap = make(map[string]string)

	fixture, err := os.ReadFile("testdata/openrouter_models_fixture.json")
	require.NoError(t, err)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(fixture)
	}))
	t.Cleanup(server.Close)

	channel := model.Channel{Name: "openrouter-sync-test", Type: 20, Key: "test-key", BaseURL: lo.ToPtr(server.URL), Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)

	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.OptionMap = previousOptionMap
		modelJSON, _ := common.Marshal(oldModelRatios)
		completionJSON, _ := common.Marshal(oldCompletionRatios)
		cacheJSON, _ := common.Marshal(oldCacheRatios)
		_ = ratio_setting.UpdateModelRatioByJSONString(string(modelJSON))
		_ = ratio_setting.UpdateCompletionRatioByJSONString(string(completionJSON))
		_ = ratio_setting.UpdateCacheRatioByJSONString(string(cacheJSON))
		_ = sqlDB.Close()
	})
	return db, channel.Id
}

// TestSyncOpenRouterCatalogMergesRatiosWithoutTouchingOtherKeys is the
// protective test the ratio-safety rule requires: seed an unrelated existing
// key, run the sync, and assert that key survives the merge byte-for-byte
// while the new keys from the fixture are added.
func TestSyncOpenRouterCatalogMergesRatiosWithoutTouchingOtherKeys(t *testing.T) {
	_, channelID := setupOpenRouterSyncTest(t)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"unrelated-existing-model":9.5}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"unrelated-existing-model":3}`))

	result, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-1"})
	require.NoError(t, err)

	afterModelRatio := ratio_setting.GetModelRatioCopy()
	assert.InDelta(t, 9.5, afterModelRatio["unrelated-existing-model"], 1e-9, "a completely unrelated pre-existing key must survive the merge untouched")
	assert.InDelta(t, 0.075, afterModelRatio["gpt-4o-mini"], 1e-9)
	assert.Contains(t, result.RatioKeysAdded, "gpt-4o-mini")
	assert.Contains(t, result.RatioKeysAdded, "claude-3-haiku")

	// The gap a live run actually hit: ratio_setting.UpdateModelRatioByJSONString
	// only updates the in-memory map. Assert the write reached the options
	// table itself, not just this process's copy of it.
	var stored model.Option
	require.NoError(t, model.DB.Where("key = ?", "ModelRatio").First(&stored).Error)
	assert.Contains(t, stored.Value, "gpt-4o-mini", "the merged ratio map must be persisted to the options table, not just the in-memory map")
}

func TestSyncOpenRouterCatalogCreatesHiddenDisabledDrafts(t *testing.T) {
	_, channelID := setupOpenRouterSyncTest(t)

	result, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-1"})
	require.NoError(t, err)
	assert.Contains(t, result.Added, "gpt-4o-mini")
	assert.Equal(t, len(loadFixtureModels(t)), result.TotalCount, "the result must retain the raw upstream count for reconciliation")
	assert.Equal(t, 1, result.SkippedAlias)
	assert.Equal(t, 1, result.SkippedBatch)
	assert.Zero(t, result.SkippedFree)
	require.Len(t, result.TieredPricing, 1)
	assert.Equal(t, "fugu-ultra-v2", result.TieredPricing[0].PublicModelID)

	entry, err := model.GetPlatformModelCatalogByPublicID("gpt-4o-mini")
	require.NoError(t, err)
	assert.Equal(t, model.PlatformModelVisibilityHidden, entry.Visibility)
	assert.False(t, entry.APIEnabled)
	assert.Equal(t, model.PlatformModelAvailabilityAvailable, entry.AvailabilityStatus, "gpt-4o-mini has no -preview/-exp/-beta marker in its id, so it reflects the vendor's real generally-available status, not a leftover of our own review progress")
	assert.Equal(t, openRouterSyncSource, entry.SyncSource)
	assert.Equal(t, "batch-1", entry.SyncBatchID)
}

func TestSyncOpenRouterCatalogDryRunProducesPlanWithoutWriting(t *testing.T) {
	db, channelID := setupOpenRouterSyncTest(t)
	require.NoError(t, model.UpdateOption("ModelRatio", `{"manual-model":9.5}`))
	require.NoError(t, model.UpdateOption("CompletionRatio", `{"manual-model":3}`))
	require.NoError(t, model.UpdateOption("CacheRatio", `{"manual-model":0.5}`))
	beforeModelRatio := ratio_setting.GetModelRatioCopy()
	beforeCompletionRatio := ratio_setting.GetCompletionRatioCopy()
	beforeCacheRatio := ratio_setting.GetCacheRatioCopy()

	result, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{
		ChannelID: channelID,
		BatchID:   "dry-run-batch",
		DryRun:    true,
	})
	require.NoError(t, err)
	assert.True(t, result.DryRun)
	assert.Contains(t, result.Added, "gpt-4o-mini")
	assert.Contains(t, result.RatioKeysAdded, "gpt-4o-mini")
	require.NotEmpty(t, result.NewRatioKeys)
	assert.Empty(t, result.ChangedRatioKeys, "sync must never reprice an existing key")
	assert.Empty(t, result.Updated)
	assert.Empty(t, result.Disabled)

	var catalogCount int64
	require.NoError(t, db.Model(&model.PlatformModelCatalog{}).Count(&catalogCount).Error)
	assert.Zero(t, catalogCount, "dry-run must not create catalog records")
	assert.Equal(t, beforeModelRatio, ratio_setting.GetModelRatioCopy(), "dry-run must not mutate in-memory ModelRatio")
	assert.Equal(t, beforeCompletionRatio, ratio_setting.GetCompletionRatioCopy(), "dry-run must not mutate in-memory CompletionRatio")
	assert.Equal(t, beforeCacheRatio, ratio_setting.GetCacheRatioCopy(), "dry-run must not mutate in-memory CacheRatio")

	var optionsCount int64
	require.NoError(t, db.Model(&model.Option{}).Count(&optionsCount).Error)
	assert.Equal(t, int64(3), optionsCount, "dry-run must not add or replace ratio options")
}

func TestSyncOpenRouterCatalogDryRunSeparatesDescriptiveChangesFromUnchangedRows(t *testing.T) {
	_, channelID := setupOpenRouterSyncTest(t)
	_, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "initial"})
	require.NoError(t, err)

	result, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{
		ChannelID: channelID,
		BatchID:   "dry-run-repeat",
		DryRun:    true,
	})
	require.NoError(t, err)
	assert.Empty(t, result.Updated, "identical upstream data must not be reported as a descriptive update")
	assert.Contains(t, result.Unchanged, "gpt-4o-mini")
}

func TestAvailabilityStatusForReflectsUpstreamLifecycleStage(t *testing.T) {
	cases := []struct {
		id   string
		want string
	}{
		{id: "gpt-4o", want: model.PlatformModelAvailabilityAvailable},
		{id: "gemini-3-flash-preview", want: model.PlatformModelAvailabilityPreview},
		{id: "deepseek-v3.2-exp", want: model.PlatformModelAvailabilityPreview},
		{id: "claude-something-beta", want: model.PlatformModelAvailabilityPreview},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			assert.Equal(t, tc.want, availabilityStatusFor(tc.id))
		})
	}
}

// TestSyncOpenRouterCatalogNeverOverwritesAManualAvailabilityStatus guards the
// reason availability_status was pulled out of the "refresh descriptive
// fields on re-sync" block: an operator can set maintenance/disabled/
// coming_soon, none of which this sync's two-way preview/available
// classifier can express, and a later re-sync must not silently revert that.
func TestSyncOpenRouterCatalogNeverOverwritesAManualAvailabilityStatus(t *testing.T) {
	db, channelID := setupOpenRouterSyncTest(t)
	first, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-1"})
	require.NoError(t, err)
	require.Contains(t, first.Added, "gpt-4o-mini")

	require.NoError(t, db.Model(&model.PlatformModelCatalog{}).
		Where("public_model_id = ?", "gpt-4o-mini").
		Update("availability_status", model.PlatformModelAvailabilityMaintenance).Error)

	_, err = SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-2"})
	require.NoError(t, err)

	entry, err := model.GetPlatformModelCatalogByPublicID("gpt-4o-mini")
	require.NoError(t, err)
	assert.Equal(t, model.PlatformModelAvailabilityMaintenance, entry.AvailabilityStatus, "a re-sync must not revert an operator's manual maintenance/disabled/coming_soon status")
}

// TestSyncOpenRouterCatalogNeverRepricesAModelThatAlreadyHasARatio pins the
// exact bug a live full run found: gpt-4o-mini has no catalog row here but
// already has a configured ratio (real equivalent: deepseek-chat,
// gemini-2.5-pro and 6 others in the live catalog, each already priced
// through some other route and never catalogued). The first implementation
// checked only whether a *catalog* row existed and happily overwrote 8 real,
// already-configured ratios with fresh OpenRouter numbers. A ratio and a
// catalog row are independent existence checks (ADR 0007) and must be
// treated as such.
func TestSyncOpenRouterCatalogNeverRepricesAModelThatAlreadyHasARatio(t *testing.T) {
	_, channelID := setupOpenRouterSyncTest(t)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-4o-mini":9.99}`))

	result, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-1"})
	require.NoError(t, err)

	afterRatio := ratio_setting.GetModelRatioCopy()
	assert.InDelta(t, 9.99, afterRatio["gpt-4o-mini"], 1e-9, "a pre-existing ratio must never be silently repriced by this sync")
	assert.NotContains(t, result.RatioKeysAdded, "gpt-4o-mini")
	assert.Contains(t, result.ExistingRatioNotOverwritten, "gpt-4o-mini")

	entry, err := model.GetPlatformModelCatalogByPublicID("gpt-4o-mini")
	require.NoError(t, err)
	assert.True(t, entry.APIEnabled, "a model already priced elsewhere is likely already served through some other channel — cataloging it with api_enabled=false would newly block that real traffic")
}

// TestSyncOpenRouterCatalogRerunPreservesOperatorFieldsAndDisablesDelisted
// exercises the full idempotent-rerun contract in one pass: an admin
// promotes a synced row live, a second run must not revert that, must
// refresh descriptive fields, must leave a foreign (non-sync) row alone even
// though its id collides, and must disable a model the second fetch no
// longer contains.
func TestSyncOpenRouterCatalogRerunPreservesOperatorFieldsAndDisablesDelisted(t *testing.T) {
	db, channelID := setupOpenRouterSyncTest(t)

	foreign := model.PlatformModelCatalog{
		PublicModelID: "claude-3-haiku", DisplayName: "Hand-curated Haiku", ProviderKey: "platform", ProviderLabel: "HYC AI",
		DescriptionEN: "manually written", DescriptionZhCN: "手写描述", Category: "general",
		Capabilities: model.JSONStringList{"chat"}, InputModalities: model.JSONStringList{"text"}, OutputModalities: model.JSONStringList{"text"},
		IconKey: "platform", AvailabilityStatus: model.PlatformModelAvailabilityAvailable, Visibility: model.PlatformModelVisibilityPublic,
		APIEnabled: true, ShowInPricing: true,
	}
	require.NoError(t, model.CreatePlatformModelCatalog(&foreign))

	result1, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-1"})
	require.NoError(t, err)
	assert.Equal(t, len(result1.Added), result1.ZhFallbackCount,
		"zh_fallback_count must only count rows actually written, not the foreign one this run skipped")

	stillForeign, err := model.GetPlatformModelCatalogByPublicID("claude-3-haiku")
	require.NoError(t, err)
	assert.Equal(t, "Hand-curated Haiku", stillForeign.DisplayName, "a row this sync did not create must never be touched")
	assert.Empty(t, stillForeign.SyncSource)

	promoted, err := model.GetPlatformModelCatalogByPublicID("gpt-4o-mini")
	require.NoError(t, err)
	promoted.APIEnabled = true
	promoted.Visibility = model.PlatformModelVisibilityPublic
	promoted.ShowInPricing = true
	promoted.Recommended = true
	require.NoError(t, db.Save(promoted).Error)

	trimmedFixture := `{"data":[{"id":"openai/gpt-4o-mini","name":"OpenAI: GPT-4o-mini (refreshed)","description":"updated description","context_length":128000,"architecture":{"modality":"text->text","input_modalities":["text"],"output_modalities":["text"]},"pricing":{"prompt":"0.00000015","completion":"0.0000006"}}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(trimmedFixture))
	}))
	defer server.Close()
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", channelID).Update("base_url", server.URL).Error)

	result2, err := SyncOpenRouterCatalog(context.Background(), OpenRouterSyncOptions{ChannelID: channelID, BatchID: "batch-2"})
	require.NoError(t, err)
	assert.Contains(t, result2.Updated, "gpt-4o-mini")
	assert.Contains(t, result2.Disabled, "fugu-ultra-v2", "a sync-owned model absent from a later fetch must be disabled")
	assert.NotContains(t, result2.Disabled, "claude-3-haiku", "the foreign row must never appear in this sync's disable list")

	refreshed, err := model.GetPlatformModelCatalogByPublicID("gpt-4o-mini")
	require.NoError(t, err)
	assert.Equal(t, "GPT-4o-mini (refreshed)", refreshed.DisplayName, "descriptive fields must refresh on a sync-owned row")
	assert.True(t, refreshed.APIEnabled, "operator-flipped api_enabled must survive a re-sync")
	assert.Equal(t, model.PlatformModelVisibilityPublic, refreshed.Visibility, "operator-flipped visibility must survive a re-sync")
	assert.True(t, refreshed.Recommended)
	assert.Equal(t, openRouterSyncSource, refreshed.SyncSource)
	assert.Equal(t, "batch-1", refreshed.SyncBatchID, "SyncBatchID marks creation batch and must not advance on a mere update")

	stillForeign2, err := model.GetPlatformModelCatalogByPublicID("claude-3-haiku")
	require.NoError(t, err)
	assert.Equal(t, "Hand-curated Haiku", stillForeign2.DisplayName, "foreign row must remain untouched even when the id is absent from a later fetch")
	assert.NotEqual(t, model.PlatformModelAvailabilityDisabled, stillForeign2.AvailabilityStatus, "a foreign row must never be auto-disabled by this sync")
}
