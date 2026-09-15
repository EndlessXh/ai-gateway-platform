package service

import (
	"fmt"

	"github.com/QuantumNous/new-api/model"
)

// ReleaseCandidate names one catalog row to promote out of the hidden/
// unreviewed draft state a sync creates it in. EnableAPI is false for a
// model that already has api_enabled=true (it was priced elsewhere before
// this catalog row existed) — release only needs to flip its visibility.
type ReleaseCandidate struct {
	PublicModelID string
	EnableAPI     bool
}

type ReleaseResult struct {
	Released       []string `json:"released"`
	SkippedForeign []string `json:"skipped_foreign"` // exists, but this sync did not create it
	SkippedMissing []string `json:"skipped_missing"` // no catalog row at all under this id
	Failed         []string `json:"failed"`
}

// ReleasePlatformModels flips a reviewed, explicit batch of catalog rows from
// hidden draft to public. It only ever touches visibility (always) and
// api_enabled (only when the candidate asks for it) plus a recomputed
// availability_status; every other field — provider_key/label, icon_key,
// pricing, capabilities — is whatever the sync already wrote and is left
// alone. Only rows this sync created (SyncSource match) are eligible, same
// boundary the sync itself enforces on update.
//
// show_in_pricing and show_in_playground are deliberately never touched
// here, not an oversight: visibility is the only unconditionally-enforced
// gate for the general model catalog surface
// (service/platform_model_catalog.go ListPublicPlatformModels), while
// show_in_pricing only matters for surface=="pricing" and show_in_playground
// only for surface=="playground". Whether /pricing keeps existing at all is
// an open, separately tracked product decision (it was already pulled from
// public navigation and is gated behind getFreshModuleAccess('pricing') on
// the frontend); shipping a batch into a page whose fate is undecided would
// create rows to clean up if that page is removed. show_in_playground
// depends on whether the playground feature itself has shipped, which this
// release is unrelated to.
func ReleasePlatformModels(candidates []ReleaseCandidate) (*ReleaseResult, error) {
	result := &ReleaseResult{}
	for _, cand := range candidates {
		entry, err := model.GetPlatformModelCatalogByPublicID(cand.PublicModelID)
		if err != nil {
			result.SkippedMissing = append(result.SkippedMissing, cand.PublicModelID)
			continue
		}
		if entry.SyncSource != openRouterSyncSource {
			result.SkippedForeign = append(result.SkippedForeign, cand.PublicModelID)
			continue
		}

		entry.Visibility = model.PlatformModelVisibilityPublic
		if cand.EnableAPI {
			entry.APIEnabled = true
		}
		entry.AvailabilityStatus = availabilityStatusFor(entry.PublicModelID)

		if err := model.UpdatePlatformModelCatalog(entry); err != nil {
			result.Failed = append(result.Failed, fmt.Sprintf("%s: %s", cand.PublicModelID, err.Error()))
			continue
		}
		result.Released = append(result.Released, cand.PublicModelID)
	}
	return result, nil
}
