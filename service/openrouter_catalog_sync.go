package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

const openRouterSyncSource = "openrouter"

// Mirrors model.platformModelIDPattern (unexported there). Duplicated rather
// than imported because it is a small, publicly documented format contract,
// not an internal detail — model.ValidatePlatformModelCatalog remains the
// authoritative check at write time regardless.
var openRouterPublicModelIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,126}[a-z0-9]$`)

// openRouterModel mirrors the subset of OpenRouter's /v1/models response this
// sync actually consumes. Fields present upstream but not read here (
// benchmarks, supported_voices, knowledge_cutoff, per_request_limits, ...)
// are intentionally left unparsed rather than stored as unused metadata.
type openRouterModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	ContextLength int    `json:"context_length"`
	Architecture  struct {
		Modality         string   `json:"modality"`
		InputModalities  []string `json:"input_modalities"`
		OutputModalities []string `json:"output_modalities"`
	} `json:"architecture"`
	Pricing struct {
		Prompt         string `json:"prompt"`
		Completion     string `json:"completion"`
		InputCacheRead string `json:"input_cache_read"`
		Overrides      []struct {
			MinPromptTokens int    `json:"min_prompt_tokens"`
			Prompt          string `json:"prompt"`
			Completion      string `json:"completion"`
		} `json:"overrides"`
	} `json:"pricing"`
	SupportedParameters []string `json:"supported_parameters"`
	Reasoning           any      `json:"reasoning"`
}

type openRouterModelsResponse struct {
	Data []openRouterModel `json:"data"`
}

// OpenRouterSyncOptions configures one sync run.
type OpenRouterSyncOptions struct {
	// ChannelID identifies the OpenRouter channel whose key is used to call
	// /v1/models. The sync never reads or logs the key itself.
	ChannelID int
	BatchID   string
	// DryRun performs the complete fetch, filtering, derivation and change
	// calculation without writing platform_model_catalog, ratio_setting, or
	// channels. Production operators must review this result before applying a
	// first sync because adding a model also adds ratio_setting entries.
	DryRun bool
}

type TieredPricingNote struct {
	PublicModelID   string  `json:"public_model_id"`
	BaseRatio       float64 `json:"base_ratio"`
	TopTierRatio    float64 `json:"top_tier_ratio"`
	ThresholdTokens int     `json:"threshold_tokens"`
}

type OpenRouterSyncResult struct {
	BatchID           string   `json:"batch_id"`
	DryRun            bool     `json:"dry_run"`
	Added             []string `json:"added"`
	Updated           []string `json:"updated"`
	Unchanged         []string `json:"unchanged"`
	Disabled          []string `json:"disabled"`
	SkippedAlias      int      `json:"skipped_alias"`
	SkippedBatch      int      `json:"skipped_batch"`
	SkippedFree       int      `json:"skipped_free"`
	SkippedForeign    []string `json:"skipped_foreign"` // pre-existing rows this sync did not create; left untouched
	SkippedUnparsable []string `json:"skipped_unparsable"`
	Failed            []string `json:"failed"` // candidate passed derivation but the DB write itself was rejected (e.g. validation)
	// ExistingRatioNotOverwritten lists models that got a (new or refreshed)
	// catalog entry this run, but whose ratio_setting entry already existed
	// under some other name/history and was deliberately left untouched.
	// Repricing an already-priced model is a reviewed decision, never a sync
	// side effect — this list is exactly the candidate set for that review.
	ExistingRatioNotOverwritten []string            `json:"existing_ratio_not_overwritten"`
	TieredPricing               []TieredPricingNote `json:"tiered_pricing"`
	ZhFallbackCount             int                 `json:"zh_fallback_count"`
	RatioKeysAdded              []string            `json:"ratio_keys_added"`
	// NewRatioKeys is the reviewable per-model ratio plan. ChangedRatioKeys is
	// intentionally empty for this synchronizer: repricing an existing key is
	// a separately approved operation, never a sync side effect.
	NewRatioKeys     []OpenRouterRatioChange `json:"new_ratio_keys"`
	ChangedRatioKeys []OpenRouterRatioChange `json:"changed_ratio_keys"`
	TotalCount       int                     `json:"total_count"`
}

type OpenRouterRatioChange struct {
	PublicModelID   string   `json:"public_model_id"`
	ModelRatio      float64  `json:"model_ratio"`
	CompletionRatio float64  `json:"completion_ratio"`
	CacheRatio      *float64 `json:"cache_ratio,omitempty"`
}

// catalogCandidate is the derived, ready-to-write shape of one OpenRouter
// model. Building this is a pure transform with no I/O, which is what makes
// it unit-testable against a fixture without a database or network.
type catalogCandidate struct {
	PublicModelID    string
	DisplayName      string
	ProviderKey      string
	ProviderLabel    string
	DescriptionEN    string
	Category         string
	Capabilities     []string
	InputModalities  []string
	OutputModalities []string
	ContextLabel     string
	ContextTokens    int
	ModelRatio       float64
	CompletionRatio  float64
	CacheRatio       float64
	HasCacheRatio    bool
	TieredNote       *TieredPricingNote
}

// deriveCandidates filters out `~`-prefixed alias pointers, `:batch` variants,
// and product-excluded free supply, then converts the remainder into
// catalogCandidate values. OpenRouter's free tier has strict rate limits and
// can be withdrawn at any time, so it is not suitable supply for a paid
// product. This includes `:free` variants, OpenRouter's free router, and the
// two Lyria models currently listed at a zero price. Two OpenRouter models that
// would strip to the same public_model_id (rare, but not impossible across
// vendors) both keep their full vendor-prefixed id instead — resolved with a
// pre-flight pass over the whole batch before any candidate is finalized, not a
// first-wins race.
func deriveCandidates(models []openRouterModel) (candidates []catalogCandidate, skippedAlias, skippedBatch, skippedFree int, skippedUnparsable []string) {
	strippedCount := make(map[string]int)
	type kept struct {
		model    openRouterModel
		stripped string
	}
	var keptModels []kept

	for _, m := range models {
		if strings.HasPrefix(m.ID, "~") {
			skippedAlias++
			continue
		}
		if strings.HasSuffix(m.ID, ":batch") {
			skippedBatch++
			continue
		}
		stripped := stripVendorPrefix(m.ID)
		if strings.HasSuffix(m.ID, ":free") || m.ID == "openrouter/free" ||
			stripped == "lyria-3-clip-preview" || stripped == "lyria-3-pro-preview" {
			skippedFree++
			continue
		}
		strippedCount[stripped]++
		keptModels = append(keptModels, kept{model: m, stripped: stripped})
	}

	for _, km := range keptModels {
		publicID := km.stripped
		if strippedCount[km.stripped] > 1 {
			publicID = sanitizePublicModelID(km.model.ID)
		}
		candidate, err := buildCandidate(km.model, publicID)
		if err != nil {
			skippedUnparsable = append(skippedUnparsable, fmt.Sprintf("%s: %s", km.model.ID, err.Error()))
			continue
		}
		candidates = append(candidates, *candidate)
	}
	return candidates, skippedAlias, skippedBatch, skippedFree, skippedUnparsable
}

// isUpstreamPreview reports the model's own upstream lifecycle stage
// (an id like "gemini-3-flash-preview" or "deepseek-v3.2-exp" is genuinely
// a vendor preview/experimental release), not how far our own review of the
// row has gotten. availability_status must track the former: labelling
// "gpt-4o" as preview because we haven't gotten to it yet is misleading,
// and labelling a real vendor preview as generally available is worse.
func isUpstreamPreview(publicModelID string) bool {
	return strings.Contains(publicModelID, "-preview") ||
		strings.Contains(publicModelID, "-exp") ||
		strings.Contains(publicModelID, "-beta")
}

func availabilityStatusFor(publicModelID string) string {
	if isUpstreamPreview(publicModelID) {
		return model.PlatformModelAvailabilityPreview
	}
	return model.PlatformModelAvailabilityAvailable
}

func stripVendorPrefix(id string) string {
	if idx := strings.Index(id, "/"); idx >= 0 && idx < len(id)-1 {
		return id[idx+1:]
	}
	return id
}

func vendorPrefix(id string) string {
	if idx := strings.Index(id, "/"); idx >= 0 {
		return id[:idx]
	}
	return id
}

// sanitizePublicModelID makes a vendor-prefixed OpenRouter id satisfy the
// same public_model_id pattern as a stripped one (lowercase, dots/underscores
// /hyphens only) by turning the "/" into "-".
func sanitizePublicModelID(id string) string {
	return strings.ReplaceAll(id, "/", "-")
}

// markdownLinkPattern matches "[text](url)", including OpenRouter's observed
// "[text](<url>)" autolink-wrapped form (e.g. Poolside's listing) — the
// trailing "]" from the URL segment falls out because [^)]* is greedy up to
// the first ")".
var markdownLinkPattern = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)

// residualAngleBracketPattern removes anything the link pattern didn't catch
// (a bare "<...>" autolink with no [text] wrapper). platform_model_catalog's
// validator rejects any '<' or '>' outright, so any remaining occurrence
// after this pass is treated as a genuinely unparsable description, not
// silently mangled further.
var residualAngleBracketPattern = regexp.MustCompile(`<[^>]*>`)

func sanitizeDescription(raw string) string {
	s := markdownLinkPattern.ReplaceAllString(raw, "$1")
	s = residualAngleBracketPattern.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

// splitVendorLabelledName splits OpenRouter's "Vendor: Model Name" convention
// (confirmed live across openai/anthropic/google/deepseek/qwen/z-ai). Falls
// back to the full name, untouched, if the colon separator isn't present —
// never fabricates a vendor label that wasn't in the source data.
func splitVendorLabelledName(name string) (label, displayName string) {
	parts := strings.SplitN(name, ": ", 2)
	if len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return "", strings.TrimSpace(name)
}

// parseModality maps OpenRouter's compound "text+image+file->text" strings
// (16 distinct combinations observed live, never a bare enum) onto this
// catalog's five modality keys. Returns an error — never a silent partial
// result — for any token the parser does not recognize, so a new modality
// OpenRouter introduces later is surfaced instead of dropped.
func parseModality(inputModalities, outputModalities []string) (input, output []string, err error) {
	allowed := map[string]bool{"text": true, "image": true, "audio": true, "video": true, "file": true}
	normalize := func(values []string) ([]string, error) {
		result := make([]string, 0, len(values))
		for _, v := range values {
			v = strings.TrimSpace(strings.ToLower(v))
			if !allowed[v] {
				return nil, fmt.Errorf("unrecognized modality %q", v)
			}
			result = append(result, v)
		}
		return result, nil
	}
	input, err = normalize(inputModalities)
	if err != nil {
		return nil, nil, err
	}
	output, err = normalize(outputModalities)
	if err != nil {
		return nil, nil, err
	}
	if len(input) == 0 || len(output) == 0 {
		return nil, nil, fmt.Errorf("missing input or output modality")
	}
	return input, output, nil
}

func deriveCapabilities(m openRouterModel, inputModalities []string) []string {
	capabilities := []string{"chat", "streaming"}
	for _, mod := range inputModalities {
		if mod == "image" {
			capabilities = append(capabilities, "vision")
			break
		}
	}
	for _, p := range m.SupportedParameters {
		if p == "tools" {
			capabilities = append(capabilities, "tools")
			break
		}
	}
	if m.Reasoning != nil {
		capabilities = append(capabilities, "reasoning")
	}
	return capabilities
}

func formatContextLabel(tokens int) string {
	switch {
	case tokens <= 0:
		return ""
	case tokens%1_000_000 == 0:
		return fmt.Sprintf("%dM context", tokens/1_000_000)
	case tokens%1_000 == 0:
		return fmt.Sprintf("%dK context", tokens/1_000)
	default:
		return fmt.Sprintf("%d tokens context", tokens)
	}
}

// convertRatio mirrors controller/ratio_sync.go's convertOpenRouterToRatioData
// arithmetic and edge cases (free models, unparsable/negative sentinel
// prices) without importing that upstream file. model_ratio stays a 1:1
// reflection of OpenRouter's own cost; no markup is applied here.
func convertRatio(promptStr, completionStr, cacheReadStr string) (modelRatio, completionRatio, cacheRatio float64, hasCacheRatio bool, ok bool) {
	promptPrice, promptErr := strconv.ParseFloat(promptStr, 64)
	completionPrice, compErr := strconv.ParseFloat(completionStr, 64)
	if promptErr != nil && compErr != nil {
		return 0, 0, 0, false, false
	}
	if promptErr != nil {
		promptPrice = 0
	}
	if compErr != nil {
		completionPrice = 0
	}
	if promptPrice < 0 || completionPrice < 0 {
		return 0, 0, 0, false, false
	}
	if promptPrice == 0 && completionPrice == 0 {
		return 0, 0, 0, false, true
	}
	if promptPrice <= 0 {
		return 0, 0, 0, false, false
	}
	modelRatio = roundRatio(promptPrice * 1000 * ratio_setting.USD)
	completionRatio = roundRatio(completionPrice / promptPrice)
	if cacheReadStr != "" {
		if cachePrice, err := strconv.ParseFloat(cacheReadStr, 64); err == nil && cachePrice >= 0 {
			cacheRatio = roundRatio(cachePrice / promptPrice)
			hasCacheRatio = true
		}
	}
	return modelRatio, completionRatio, cacheRatio, hasCacheRatio, true
}

func roundRatio(v float64) float64 {
	return float64(int64(v*1e6+0.5)) / 1e6
}

func buildCandidate(m openRouterModel, publicID string) (*catalogCandidate, error) {
	if !openRouterPublicModelIDPattern.MatchString(publicID) {
		return nil, fmt.Errorf("derived public_model_id %q is not a valid identifier", publicID)
	}
	input, output, err := parseModality(m.Architecture.InputModalities, m.Architecture.OutputModalities)
	if err != nil {
		return nil, err
	}
	providerLabel, displayName := splitVendorLabelledName(m.Name)
	providerKey := vendorPrefix(m.ID)
	if providerLabel == "" {
		providerLabel = providerKey
	}

	promptPrice, completionPrice, cacheReadPrice := m.Pricing.Prompt, m.Pricing.Completion, m.Pricing.InputCacheRead
	var tieredNote *TieredPricingNote
	if len(m.Pricing.Overrides) > 0 {
		top := m.Pricing.Overrides[0]
		for _, tier := range m.Pricing.Overrides {
			if tier.MinPromptTokens > top.MinPromptTokens {
				top = tier
			}
		}
		baseRatio, _, _, _, baseOk := convertRatio(promptPrice, completionPrice, "")
		topRatio, _, _, _, topOk := convertRatio(top.Prompt, top.Completion, "")
		if baseOk && topOk {
			tieredNote = &TieredPricingNote{
				PublicModelID:   publicID,
				BaseRatio:       baseRatio,
				TopTierRatio:    topRatio,
				ThresholdTokens: top.MinPromptTokens,
			}
		}
		promptPrice, completionPrice = top.Prompt, top.Completion
	}

	modelRatio, completionRatio, cacheRatio, hasCacheRatio, ok := convertRatio(promptPrice, completionPrice, cacheReadPrice)
	if !ok {
		return nil, fmt.Errorf("unusable pricing (prompt=%q completion=%q)", m.Pricing.Prompt, m.Pricing.Completion)
	}

	return &catalogCandidate{
		PublicModelID:    publicID,
		DisplayName:      displayName,
		ProviderKey:      providerKey,
		ProviderLabel:    providerLabel,
		DescriptionEN:    sanitizeDescription(m.Description),
		Category:         "general",
		Capabilities:     deriveCapabilities(m, input),
		InputModalities:  input,
		OutputModalities: output,
		ContextLabel:     formatContextLabel(m.ContextLength),
		ContextTokens:    m.ContextLength,
		ModelRatio:       modelRatio,
		CompletionRatio:  completionRatio,
		CacheRatio:       cacheRatio,
		HasCacheRatio:    hasCacheRatio,
		TieredNote:       tieredNote,
	}, nil
}

func fetchOpenRouterModels(ctx context.Context, channelID int) ([]openRouterModel, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, fmt.Errorf("load channel: %w", err)
	}
	key, _, apiErr := channel.GetNextEnabledKey()
	if apiErr != nil {
		return nil, fmt.Errorf("no enabled key for channel %d: %s", channelID, apiErr.Error())
	}
	baseURL := strings.TrimRight(channel.GetBaseURL(), "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(key))

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openrouter returned status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var parsed openRouterModelsResponse
	if err := common.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode /v1/models response: %w", err)
	}
	return parsed.Data, nil
}

// SyncOpenRouterCatalog fetches OpenRouter's live catalog and upserts it into
// platform_model_catalog. It never writes Channel.Models/ModelMapping — a
// synced entry becomes callable only once an operator wires it into a
// channel, matching how platform_model_catalog already treats route
// existence as an independent, diagnosable concern (ADR 0007).
func SyncOpenRouterCatalog(ctx context.Context, opts OpenRouterSyncOptions) (*OpenRouterSyncResult, error) {
	batchID := opts.BatchID
	if batchID == "" {
		batchID = time.Now().UTC().Format("20060102T150405Z")
	}
	result := &OpenRouterSyncResult{
		BatchID:          batchID,
		DryRun:           opts.DryRun,
		NewRatioKeys:     []OpenRouterRatioChange{},
		ChangedRatioKeys: []OpenRouterRatioChange{},
	}

	models, err := fetchOpenRouterModels(ctx, opts.ChannelID)
	if err != nil {
		return nil, err
	}

	result.TotalCount = len(models)
	candidates, skippedAlias, skippedBatch, skippedFree, skippedUnparsable := deriveCandidates(models)
	result.SkippedAlias = skippedAlias
	result.SkippedBatch = skippedBatch
	result.SkippedFree = skippedFree
	result.SkippedUnparsable = skippedUnparsable

	existing, err := model.ListPlatformModelCatalog()
	if err != nil {
		return nil, fmt.Errorf("list existing catalog: %w", err)
	}
	existingByID := make(map[string]model.PlatformModelCatalog, len(existing))
	for _, e := range existing {
		existingByID[e.PublicModelID] = e
	}
	seenThisRun := make(map[string]bool, len(candidates))
	// Production safeguard from the 2026-09-11 incident: a ratio can exist
	// (default table, a prior admin override, a direct channel's own pricing)
	// for a public_model_id with no catalog row at all. catalog and
	// ratio_setting are independent stores, so both must be checked before any
	// sync writes a price. A candidate can get a brand new catalog row while its
	// pre-existing ratio remains untouched. Before any production repricing,
	// separately rerun the read-only route check against that production database:
	// abilities, channel model_mapping, and recent consume logs. Development
	// database results are not evidence about production traffic.
	existingModelRatio := ratio_setting.GetModelRatioCopy()

	pendingModelRatio := make(map[string]float64)
	pendingCompletionRatio := make(map[string]float64)
	pendingCacheRatio := make(map[string]float64)

	for _, cand := range candidates {
		seenThisRun[cand.PublicModelID] = true

		row, isExisting := existingByID[cand.PublicModelID]
		if isExisting && row.SyncSource != openRouterSyncSource {
			result.SkippedForeign = append(result.SkippedForeign, cand.PublicModelID)
			continue
		}

		// Only reached for a candidate this sync will actually write (create
		// or update) — counted here, not for every derived candidate, so
		// these stats describe what landed in the database, not what was
		// merely considered.
		if cand.TieredNote != nil {
			result.TieredPricing = append(result.TieredPricing, *cand.TieredNote)
		}
		result.ZhFallbackCount++

		if isExisting {
			previous := row
			row.DisplayName = cand.DisplayName
			row.DescriptionEN = cand.DescriptionEN
			row.DescriptionZhCN = cand.DescriptionEN
			row.Category = cand.Category
			row.Capabilities = model.JSONStringList(cand.Capabilities)
			row.InputModalities = model.JSONStringList(cand.InputModalities)
			row.OutputModalities = model.JSONStringList(cand.OutputModalities)
			row.ContextLabel = cand.ContextLabel
			row.ContextTokens = cand.ContextTokens
			// SyncSource/SyncBatchID, ProviderKey/ProviderLabel, icon_key,
			// badge_key, availability_status, and every operator-facing switch
			// (api_enabled, visibility, show_in_pricing, show_in_playground,
			// recommended) are left exactly as read — never reset to this
			// run's values. availability_status specifically: an operator may
			// have set maintenance/disabled/coming_soon, states this sync's
			// two-way preview/available classifier cannot express and must
			// not clobber. New rows still get the classifier's answer at
			// creation time, below.
			if reflect.DeepEqual(previous, row) {
				result.Unchanged = append(result.Unchanged, cand.PublicModelID)
				continue
			}
			if err := model.ValidatePlatformModelCatalog(&row); err != nil {
				result.Failed = append(result.Failed, fmt.Sprintf("%s: update validation: %s", cand.PublicModelID, err.Error()))
				continue
			}
			if !opts.DryRun {
				if err := model.UpdatePlatformModelCatalog(&row); err != nil {
					result.Failed = append(result.Failed, fmt.Sprintf("%s: update: %s", cand.PublicModelID, err.Error()))
					continue
				}
			}
			result.Updated = append(result.Updated, cand.PublicModelID)
			continue
		}

		// A ratio can already exist for this public_model_id with no catalog
		// row at all (default table, a prior override, a direct channel's
		// own pricing never catalogued). Two consequences, not one:
		//  - the ratio itself must not be touched; repricing an
		//    already-priced model is a reviewed decision, not a sync side
		//    effect (see ExistingRatioNotOverwritten below).
		//  - api_enabled must default true, not false: the model is very
		//    likely already being served through some other channel with no
		//    catalog entry, and platform_model_catalog's API gate blocks a
		//    model outright once it is cataloged with api_enabled=false
		//    (middleware/distributor.go) — defaulting to false here would
		//    newly break real, already-working traffic the moment this row
		//    is created, not just gate the OpenRouter route being added.
		_, ratioAlreadyExists := existingModelRatio[cand.PublicModelID]

		newRow := model.PlatformModelCatalog{
			PublicModelID:      cand.PublicModelID,
			DisplayName:        cand.DisplayName,
			ProviderKey:        cand.ProviderKey,
			ProviderLabel:      cand.ProviderLabel,
			DescriptionEN:      cand.DescriptionEN,
			DescriptionZhCN:    cand.DescriptionEN,
			Category:           cand.Category,
			Capabilities:       model.JSONStringList(cand.Capabilities),
			InputModalities:    model.JSONStringList(cand.InputModalities),
			OutputModalities:   model.JSONStringList(cand.OutputModalities),
			ContextLabel:       cand.ContextLabel,
			ContextTokens:      cand.ContextTokens,
			IconKey:            "platform",
			AvailabilityStatus: availabilityStatusFor(cand.PublicModelID),
			Visibility:         model.PlatformModelVisibilityHidden,
			APIEnabled:         ratioAlreadyExists,
			SyncSource:         openRouterSyncSource,
			SyncBatchID:        batchID,
		}
		if err := model.ValidatePlatformModelCatalog(&newRow); err != nil {
			result.Failed = append(result.Failed, fmt.Sprintf("%s: create validation: %s", cand.PublicModelID, err.Error()))
			continue
		}
		if !opts.DryRun {
			if err := model.CreatePlatformModelCatalog(&newRow); err != nil {
				result.Failed = append(result.Failed, fmt.Sprintf("%s: create: %s", cand.PublicModelID, err.Error()))
				continue
			}
		}
		result.Added = append(result.Added, cand.PublicModelID)
		if ratioAlreadyExists {
			result.ExistingRatioNotOverwritten = append(result.ExistingRatioNotOverwritten, cand.PublicModelID)
		} else {
			pendingModelRatio[cand.PublicModelID] = cand.ModelRatio
			pendingCompletionRatio[cand.PublicModelID] = cand.CompletionRatio
			ratioChange := OpenRouterRatioChange{
				PublicModelID:   cand.PublicModelID,
				ModelRatio:      cand.ModelRatio,
				CompletionRatio: cand.CompletionRatio,
			}
			if cand.HasCacheRatio {
				pendingCacheRatio[cand.PublicModelID] = cand.CacheRatio
				cacheRatio := cand.CacheRatio
				ratioChange.CacheRatio = &cacheRatio
			}
			result.NewRatioKeys = append(result.NewRatioKeys, ratioChange)
		}
	}

	for _, e := range existing {
		if e.SyncSource == openRouterSyncSource && !seenThisRun[e.PublicModelID] && e.AvailabilityStatus != model.PlatformModelAvailabilityDisabled {
			e.AvailabilityStatus = model.PlatformModelAvailabilityDisabled
			if err := model.ValidatePlatformModelCatalog(&e); err != nil {
				result.Failed = append(result.Failed, fmt.Sprintf("%s: disable validation: %s", e.PublicModelID, err.Error()))
				continue
			}
			if !opts.DryRun {
				if err := model.UpdatePlatformModelCatalog(&e); err != nil {
					result.Failed = append(result.Failed, fmt.Sprintf("%s: disable: %s", e.PublicModelID, err.Error()))
					continue
				}
			}
			result.Disabled = append(result.Disabled, e.PublicModelID)
		}
	}

	if len(pendingModelRatio) > 0 {
		if !opts.DryRun {
			if err := mergeRatioMaps(pendingModelRatio, pendingCompletionRatio, pendingCacheRatio); err != nil {
				return nil, fmt.Errorf("merge ratio maps: %w", err)
			}
		}
		for k := range pendingModelRatio {
			result.RatioKeysAdded = append(result.RatioKeysAdded, k)
		}
		sort.Strings(result.RatioKeysAdded)
	}

	sort.Strings(result.Added)
	sort.Strings(result.Updated)
	sort.Strings(result.Unchanged)
	sort.Strings(result.Disabled)
	sort.Strings(result.SkippedForeign)
	sort.Strings(result.ExistingRatioNotOverwritten)
	sort.Slice(result.NewRatioKeys, func(i, j int) bool {
		return result.NewRatioKeys[i].PublicModelID < result.NewRatioKeys[j].PublicModelID
	})
	return result, nil
}

// mergeRatioMaps reads the full live ModelRatio/CompletionRatio/CacheRatio
// maps, adds only the given new keys, and writes the full merged map back —
// never a partial replace. Every pre-existing key, for every other model, is
// preserved byte-for-byte because it is round-tripped through the same map,
// not reconstructed.
//
// Persistence goes through model.UpdateOption, not
// ratio_setting.UpdateXxxByJSONString directly: the ratio_setting functions
// only mutate the in-memory RWMap, while model.UpdateOption additionally
// saves the row to the options table, which is the only place a value
// survives a process restart or is visible to other processes reading the
// same database. Confirmed live: a first attempt calling the ratio_setting
// functions directly ran cleanly and reported hundreds of new keys, but a
// before/after dump of the options table showed zero change — this
// process's in-memory map was updated and then discarded on exit.
func mergeRatioMaps(modelRatio, completionRatio, cacheRatio map[string]float64) error {
	mergedModel := ratio_setting.GetModelRatioCopy()
	for k, v := range modelRatio {
		mergedModel[k] = v
	}
	modelJSON, err := common.Marshal(mergedModel)
	if err != nil {
		return err
	}
	if err := model.UpdateOption("ModelRatio", string(modelJSON)); err != nil {
		return err
	}

	mergedCompletion := ratio_setting.GetCompletionRatioCopy()
	for k, v := range completionRatio {
		mergedCompletion[k] = v
	}
	completionJSON, err := common.Marshal(mergedCompletion)
	if err != nil {
		return err
	}
	if err := model.UpdateOption("CompletionRatio", string(completionJSON)); err != nil {
		return err
	}

	if len(cacheRatio) > 0 {
		mergedCache := ratio_setting.GetCacheRatioCopy()
		for k, v := range cacheRatio {
			mergedCache[k] = v
		}
		cacheJSON, err := common.Marshal(mergedCache)
		if err != nil {
			return err
		}
		if err := model.UpdateOption("CacheRatio", string(cacheJSON)); err != nil {
			return err
		}
	}
	return nil
}
