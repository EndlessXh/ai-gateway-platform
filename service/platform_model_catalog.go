package service

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/samber/hot"
	"gorm.io/gorm"
)

const (
	platformModelCatalogCacheNamespace = "platform:model_catalog:v1"
	platformModelCatalogCacheKey       = "active-list"
	platformModelCatalogCacheTTL       = 30 * time.Second
)

type platformCatalogCodec struct{}

func (platformCatalogCodec) Encode(value []model.PlatformModelCatalog) (string, error) {
	raw, err := common.Marshal(value)
	return string(raw), err
}

func (platformCatalogCodec) Decode(value string) ([]model.PlatformModelCatalog, error) {
	var entries []model.PlatformModelCatalog
	err := common.UnmarshalJsonStr(value, &entries)
	return entries, err
}

var (
	platformCatalogCacheOnce sync.Once
	platformCatalogCache     *cachex.HybridCache[[]model.PlatformModelCatalog]
)

func getPlatformCatalogCache() *cachex.HybridCache[[]model.PlatformModelCatalog] {
	platformCatalogCacheOnce.Do(func() {
		platformCatalogCache = cachex.NewHybridCache(cachex.HybridCacheConfig[[]model.PlatformModelCatalog]{
			Namespace:  cachex.Namespace(platformModelCatalogCacheNamespace),
			Redis:      common.RDB,
			RedisCodec: platformCatalogCodec{},
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			Memory: func() *hot.HotCache[string, []model.PlatformModelCatalog] {
				return hot.NewHotCache[string, []model.PlatformModelCatalog](hot.LRU, 4).
					WithTTL(platformModelCatalogCacheTTL).
					WithJanitor().
					Build()
			},
		})
	})
	return platformCatalogCache
}

func listCachedPlatformCatalog() ([]model.PlatformModelCatalog, error) {
	cache := getPlatformCatalogCache()
	if entries, found, err := cache.Get(platformModelCatalogCacheKey); err == nil && found {
		return entries, nil
	} else if err != nil {
		common.SysError("platform model catalog cache read failed: " + err.Error())
	}
	entries, err := model.ListPlatformModelCatalog()
	if err != nil {
		return nil, err
	}
	if err := cache.SetWithTTL(platformModelCatalogCacheKey, entries, platformModelCatalogCacheTTL); err != nil {
		common.SysError("platform model catalog cache write failed: " + err.Error())
	}
	return entries, nil
}

func InvalidatePlatformModelCatalogCache() {
	if _, err := getPlatformCatalogCache().DeleteMany([]string{platformModelCatalogCacheKey}); err != nil {
		common.SysError("platform model catalog cache invalidation failed: " + err.Error())
	}
}

type PlatformCatalogPricing struct {
	Status               string   `json:"status"`
	QuotaType            int      `json:"quota_type"`
	ModelRatio           float64  `json:"model_ratio"`
	CompletionRatio      float64  `json:"completion_ratio"`
	ModelPrice           float64  `json:"model_price"`
	CacheRatio           *float64 `json:"cache_ratio,omitempty"`
	CreateCacheRatio     *float64 `json:"create_cache_ratio,omitempty"`
	ImageRatio           *float64 `json:"image_ratio,omitempty"`
	AudioRatio           *float64 `json:"audio_ratio,omitempty"`
	AudioCompletionRatio *float64 `json:"audio_completion_ratio,omitempty"`
}

type PlatformModelPublic struct {
	PublicModelID      string                   `json:"public_model_id"`
	DisplayName        string                   `json:"display_name"`
	ProviderKey        string                   `json:"provider_key"`
	ProviderLabel      string                   `json:"provider_label"`
	Description        string                   `json:"description"`
	Category           string                   `json:"category"`
	Capabilities       []string                 `json:"capabilities"`
	InputModalities    []string                 `json:"input_modalities"`
	OutputModalities   []string                 `json:"output_modalities"`
	ContextLabel       string                   `json:"context_label"`
	ContextTokens      int                      `json:"context_tokens"`
	IconKey            string                   `json:"icon_key"`
	Badge              string                   `json:"badge"`
	AvailabilityStatus string                   `json:"availability_status"`
	Recommended        bool                     `json:"recommended"`
	APIEnabled         bool                     `json:"api_enabled"`
	PromptCache        *PlatformPromptCacheInfo `json:"prompt_cache,omitempty"`
	Pricing            *PlatformCatalogPricing  `json:"pricing"`
	PricingStatus      string                   `json:"pricing_status"`
	RouteAvailability  string                   `json:"route_availability"`
	SortOrder          int                      `json:"sort_order"`
}

type PlatformModelDiagnostic struct {
	RouteStatus          string   `json:"route_status"`
	PricingStatus        string   `json:"pricing_status"`
	ActiveRouteCount     int      `json:"active_route_count"`
	AccessibleRouteCount int      `json:"accessible_route_count"`
	Issues               []string `json:"issues"`
}

type PlatformModelAdmin struct {
	model.PlatformModelCatalog
	Diagnostic PlatformModelDiagnostic `json:"diagnostic"`
}

func platformDescription(entry model.PlatformModelCatalog, locale string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(locale)), "zh") {
		return entry.DescriptionZhCN
	}
	return entry.DescriptionEN
}

func pricingByModelName() map[string]model.Pricing {
	pricing := model.GetPricing()
	result := make(map[string]model.Pricing, len(pricing))
	for _, item := range pricing {
		result[item.ModelName] = item
	}
	return result
}

func hasPricingConfiguration(publicModelID string) bool {
	if _, ok := ratio_setting.GetModelPrice(publicModelID, false); ok {
		return true
	}
	_, ok, _ := ratio_setting.GetModelRatio(publicModelID)
	return ok
}

func catalogPricing(item model.Pricing, configured bool) (*PlatformCatalogPricing, string) {
	if !configured {
		return nil, "unavailable"
	}
	return &PlatformCatalogPricing{
		Status:               "configured",
		QuotaType:            item.QuotaType,
		ModelRatio:           item.ModelRatio,
		CompletionRatio:      item.CompletionRatio,
		ModelPrice:           item.ModelPrice,
		CacheRatio:           item.CacheRatio,
		CreateCacheRatio:     item.CreateCacheRatio,
		ImageRatio:           item.ImageRatio,
		AudioRatio:           item.AudioRatio,
		AudioCompletionRatio: item.AudioCompletionRatio,
	}, "configured"
}

func routeDiagnostic(entry model.PlatformModelCatalog, usableGroups map[string]string, pricingConfigured bool) (PlatformModelDiagnostic, error) {
	summary, err := model.GetPlatformModelRouteSummary(entry.PublicModelID, usableGroups)
	if err != nil {
		return PlatformModelDiagnostic{}, err
	}
	diagnostic := PlatformModelDiagnostic{
		PricingStatus:        "configured",
		ActiveRouteCount:     summary.ActiveRouteCount,
		AccessibleRouteCount: summary.AccessibleRouteCount,
		Issues:               make([]string, 0, 3),
	}
	switch {
	case summary.ActiveRouteCount == 0:
		diagnostic.RouteStatus = "no_active_route"
		diagnostic.Issues = append(diagnostic.Issues, "no_active_route")
	case summary.AccessibleRouteCount == 0:
		diagnostic.RouteStatus = "not_accessible"
		diagnostic.Issues = append(diagnostic.Issues, "no_accessible_route")
	case !entry.APIEnabled:
		diagnostic.RouteStatus = "api_disabled"
	default:
		diagnostic.RouteStatus = "available"
	}
	if !pricingConfigured {
		diagnostic.PricingStatus = "unavailable"
		diagnostic.Issues = append(diagnostic.Issues, "no_pricing_configuration")
	}
	if entry.Visibility == model.PlatformModelVisibilityHidden && entry.APIEnabled {
		diagnostic.Issues = append(diagnostic.Issues, "hidden_but_callable")
	}
	if entry.Visibility == model.PlatformModelVisibilityPublic && !entry.APIEnabled {
		diagnostic.Issues = append(diagnostic.Issues, "visible_but_disabled")
	}
	return diagnostic, nil
}

func publicPlatformModel(entry model.PlatformModelCatalog, locale string, userGroup string, prices map[string]model.Pricing) (PlatformModelPublic, error) {
	priceItem := prices[entry.PublicModelID]
	configured := hasPricingConfiguration(entry.PublicModelID)
	pricing, pricingStatus := catalogPricing(priceItem, configured)
	diagnostic, err := routeDiagnostic(entry, GetUserUsableGroups(userGroup), configured)
	if err != nil {
		return PlatformModelPublic{}, err
	}
	return PlatformModelPublic{
		PublicModelID:      entry.PublicModelID,
		DisplayName:        entry.DisplayName,
		ProviderKey:        entry.ProviderKey,
		ProviderLabel:      entry.ProviderLabel,
		Description:        platformDescription(entry, locale),
		Category:           entry.Category,
		Capabilities:       append([]string(nil), entry.Capabilities...),
		InputModalities:    append([]string(nil), entry.InputModalities...),
		OutputModalities:   append([]string(nil), entry.OutputModalities...),
		ContextLabel:       entry.ContextLabel,
		ContextTokens:      entry.ContextTokens,
		IconKey:            entry.IconKey,
		Badge:              entry.BadgeKey,
		AvailabilityStatus: entry.AvailabilityStatus,
		Recommended:        entry.Recommended,
		APIEnabled:         entry.APIEnabled,
		PromptCache:        promptCacheInfo(entry.PublicModelID),
		Pricing:            pricing,
		PricingStatus:      pricingStatus,
		RouteAvailability:  diagnostic.RouteStatus,
		SortOrder:          entry.SortOrder,
	}, nil
}

func ListPublicPlatformModels(locale string, surface string, userGroup string) ([]PlatformModelPublic, error) {
	if surface != "" && surface != "models" && surface != "pricing" && surface != "playground" {
		return nil, errors.New("invalid catalog surface")
	}
	entries, err := listCachedPlatformCatalog()
	if err != nil {
		return nil, err
	}
	prices := pricingByModelName()
	result := make([]PlatformModelPublic, 0, len(entries))
	for _, entry := range entries {
		if entry.Visibility != model.PlatformModelVisibilityPublic {
			continue
		}
		if surface == "pricing" && !entry.ShowInPricing {
			continue
		}
		if surface == "playground" && !entry.ShowInPlayground {
			continue
		}
		item, err := publicPlatformModel(entry, locale, userGroup, prices)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func GetPublicPlatformModel(publicModelID string, locale string, userGroup string) (*PlatformModelPublic, error) {
	entries, err := listCachedPlatformCatalog()
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.PublicModelID == publicModelID && entry.Visibility == model.PlatformModelVisibilityPublic {
			item, err := publicPlatformModel(entry, locale, userGroup, pricingByModelName())
			return &item, err
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func IsPlatformModelAPIEnabled(publicModelID string) (cataloged bool, enabled bool, err error) {
	entries, err := listCachedPlatformCatalog()
	if err != nil {
		return false, false, err
	}
	for _, entry := range entries {
		if entry.PublicModelID == publicModelID {
			return true, entry.APIEnabled, nil
		}
	}
	return false, false, nil
}

func ListAdminPlatformModels(search string, status string) ([]PlatformModelAdmin, error) {
	entries, err := model.ListPlatformModelCatalog()
	if err != nil {
		return nil, err
	}
	search = strings.ToLower(strings.TrimSpace(search))
	usableGroups := GetUserUsableGroups("")
	result := make([]PlatformModelAdmin, 0, len(entries))
	for _, entry := range entries {
		if status != "" && entry.AvailabilityStatus != status {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(entry.PublicModelID+" "+entry.DisplayName+" "+entry.ProviderLabel), search) {
			continue
		}
		diagnostic, err := routeDiagnostic(entry, usableGroups, hasPricingConfiguration(entry.PublicModelID))
		if err != nil {
			return nil, err
		}
		result = append(result, PlatformModelAdmin{PlatformModelCatalog: entry, Diagnostic: diagnostic})
	}
	return result, nil
}

func CreatePlatformModel(entry *model.PlatformModelCatalog) error {
	if err := model.ValidatePlatformModelCatalog(entry); err != nil {
		return err
	}
	if err := model.CreatePlatformModelCatalog(entry); err != nil {
		return normalizePlatformCatalogWriteError(err)
	}
	InvalidatePlatformModelCatalogCache()
	return nil
}

func UpdatePlatformModel(entry *model.PlatformModelCatalog) error {
	if err := model.ValidatePlatformModelCatalog(entry); err != nil {
		return err
	}
	if err := model.UpdatePlatformModelCatalog(entry); err != nil {
		return normalizePlatformCatalogWriteError(err)
	}
	InvalidatePlatformModelCatalogCache()
	return nil
}

func ArchivePlatformModel(id int) error {
	if err := model.ArchivePlatformModelCatalog(id); err != nil {
		return err
	}
	InvalidatePlatformModelCatalogCache()
	return nil
}

func normalizePlatformCatalogWriteError(err error) error {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "unique") || strings.Contains(message, "duplicate") {
		return errors.New("public_model_id already exists")
	}
	return fmt.Errorf("model catalog write failed")
}

// AggregatePlatformPricing adds catalog presentation metadata while retaining
// the existing ratio_setting-derived pricing values as the only price truth.
func AggregatePlatformPricing(pricing []model.Pricing, locale string, userGroup string) ([]model.Pricing, error) {
	entries, err := listCachedPlatformCatalog()
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return pricing, nil
	}
	pricingMap := make(map[string]model.Pricing, len(pricing))
	for _, item := range pricing {
		pricingMap[item.ModelName] = item
	}
	result := make([]model.Pricing, 0, len(entries))
	usableGroups := GetUserUsableGroups(userGroup)
	for _, entry := range entries {
		if entry.Visibility != model.PlatformModelVisibilityPublic || !entry.ShowInPricing {
			continue
		}
		item := pricingMap[entry.PublicModelID]
		item.ModelName = entry.PublicModelID
		item.DisplayName = entry.DisplayName
		item.Description = platformDescription(entry, locale)
		item.ProviderKey = entry.ProviderKey
		item.ProviderLabel = entry.ProviderLabel
		item.Category = entry.Category
		item.Capabilities = append([]string(nil), entry.Capabilities...)
		item.InputModalities = append([]string(nil), entry.InputModalities...)
		item.OutputModalities = append([]string(nil), entry.OutputModalities...)
		item.ContextLabel = entry.ContextLabel
		item.ContextTokens = entry.ContextTokens
		item.IconKey = entry.IconKey
		item.BadgeKey = entry.BadgeKey
		item.AvailabilityStatus = entry.AvailabilityStatus
		item.Recommended = entry.Recommended
		item.APIEnabled = entry.APIEnabled
		configured := hasPricingConfiguration(entry.PublicModelID)
		if configured {
			item.PlatformPricingStatus = "configured"
		} else {
			item.PlatformPricingStatus = "unavailable"
		}
		diagnostic, err := routeDiagnostic(entry, usableGroups, configured)
		if err != nil {
			return nil, err
		}
		item.RouteAvailability = diagnostic.RouteStatus
		result = append(result, item)
	}
	return result, nil
}
