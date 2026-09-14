package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/model"
)

// OpenRouterCatalogRollbackResult is intentionally a list, not a count-only
// acknowledgement, so operators can review exactly which rows a batch rollback
// would remove. The default command mode is dry-run; Apply must be explicit.
type OpenRouterCatalogRollbackResult struct {
	BatchID string   `json:"batch_id"`
	DryRun  bool     `json:"dry_run"`
	Models  []string `json:"models"`
	Deleted []string `json:"deleted"`
}

// RollbackOpenRouterCatalogBatch soft-deletes only rows created by the named
// OpenRouter sync batch. It cannot touch rows merely updated by that batch:
// updates preserve their original SyncBatchID, and manually created rows have
// no matching SyncSource/SyncBatchID.
func RollbackOpenRouterCatalogBatch(batchID string, apply bool) (*OpenRouterCatalogRollbackResult, error) {
	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return nil, fmt.Errorf("sync batch id is required")
	}

	entries, err := model.ListPlatformModelCatalogBySyncBatch(openRouterSyncSource, batchID)
	if err != nil {
		return nil, fmt.Errorf("list sync batch: %w", err)
	}
	result := &OpenRouterCatalogRollbackResult{BatchID: batchID, DryRun: !apply}
	for _, entry := range entries {
		result.Models = append(result.Models, entry.PublicModelID)
	}
	if !apply {
		return result, nil
	}

	for _, entry := range entries {
		if err := model.ArchivePlatformModelCatalog(entry.ID); err != nil {
			return nil, fmt.Errorf("archive %s: %w", entry.PublicModelID, err)
		}
		result.Deleted = append(result.Deleted, entry.PublicModelID)
	}
	return result, nil
}
