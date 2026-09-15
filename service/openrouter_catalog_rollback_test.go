package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRollbackOpenRouterCatalogBatchListsThenDeletesOnlyCreatedRows(t *testing.T) {
	_, _ = setupOpenRouterSyncTest(t)
	batchRow := model.PlatformModelCatalog{
		PublicModelID: "batch-created-model", DisplayName: "Batch Created Model",
		ProviderKey: "openrouter", ProviderLabel: "OpenRouter", DescriptionEN: "created by batch",
		DescriptionZhCN: "created by batch", Category: "general", Capabilities: model.JSONStringList{"chat"},
		InputModalities: model.JSONStringList{"text"}, OutputModalities: model.JSONStringList{"text"},
		AvailabilityStatus: model.PlatformModelAvailabilityAvailable, Visibility: model.PlatformModelVisibilityHidden,
		SyncSource: openRouterSyncSource, SyncBatchID: "batch-to-rollback",
	}
	otherBatchRow := batchRow
	otherBatchRow.PublicModelID = "other-batch-model"
	otherBatchRow.DisplayName = "Other Batch Model"
	otherBatchRow.SyncBatchID = "other-batch"
	manualRow := batchRow
	manualRow.PublicModelID = "manual-model"
	manualRow.DisplayName = "Manual Model"
	manualRow.SyncSource = ""
	manualRow.SyncBatchID = ""
	require.NoError(t, model.CreatePlatformModelCatalog(&batchRow))
	require.NoError(t, model.CreatePlatformModelCatalog(&otherBatchRow))
	require.NoError(t, model.CreatePlatformModelCatalog(&manualRow))

	dryRun, err := RollbackOpenRouterCatalogBatch("batch-to-rollback", false)
	require.NoError(t, err)
	assert.True(t, dryRun.DryRun)
	assert.Equal(t, []string{"batch-created-model"}, dryRun.Models)
	assert.Empty(t, dryRun.Deleted)
	_, err = model.GetPlatformModelCatalogByPublicID("batch-created-model")
	require.NoError(t, err, "dry-run must not delete the candidate")

	applied, err := RollbackOpenRouterCatalogBatch("batch-to-rollback", true)
	require.NoError(t, err)
	assert.False(t, applied.DryRun)
	assert.Equal(t, []string{"batch-created-model"}, applied.Deleted)
	_, err = model.GetPlatformModelCatalogByPublicID("batch-created-model")
	assert.Error(t, err)
	_, err = model.GetPlatformModelCatalogByPublicID("other-batch-model")
	require.NoError(t, err, "another batch must not be deleted")
	_, err = model.GetPlatformModelCatalogByPublicID("manual-model")
	require.NoError(t, err, "manual rows must not be deleted")
}
