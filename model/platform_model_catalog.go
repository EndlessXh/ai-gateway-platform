package model

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	PlatformModelAvailabilityAvailable   = "available"
	PlatformModelAvailabilityPreview     = "preview"
	PlatformModelAvailabilityMaintenance = "maintenance"
	PlatformModelAvailabilityComingSoon  = "coming_soon"
	PlatformModelAvailabilityDisabled    = "disabled"
	PlatformModelVisibilityPublic        = "public"
	PlatformModelVisibilityHidden        = "hidden"
)

// maxPlatformContextTokens is a defensive input ceiling, not a modeled business
// limit. The largest context_length observed across OpenRouter's live catalog
// (444 models, fetched 2026-09-11) was 2,000,000; this leaves wide headroom
// while still rejecting obviously corrupt sync input (unit mixups, overflow).
const maxPlatformContextTokens = 100_000_000

var platformModelIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,126}[a-z0-9]$`)
var platformModelKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// JSONStringList is persisted as a JSON array in a portable TEXT column.
// It intentionally avoids database-specific JSONB and comma-separated values.
type JSONStringList []string

func (list JSONStringList) Value() (driver.Value, error) {
	if list == nil {
		list = JSONStringList{}
	}
	raw, err := common.Marshal(list)
	if err != nil {
		return nil, err
	}
	return string(raw), nil
}

func (list *JSONStringList) Scan(value any) error {
	if list == nil {
		return errors.New("cannot scan JSON list into nil receiver")
	}
	if value == nil {
		*list = JSONStringList{}
		return nil
	}
	var raw []byte
	switch typed := value.(type) {
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		return fmt.Errorf("unsupported JSON list database type %T", value)
	}
	if len(raw) == 0 {
		*list = JSONStringList{}
		return nil
	}
	return common.Unmarshal(raw, list)
}

type PlatformModelCatalog struct {
	ID                 int            `json:"id" gorm:"primaryKey"`
	PublicModelID      string         `json:"public_model_id" gorm:"type:varchar(128);not null;uniqueIndex:idx_platform_model_catalog_public_id"`
	DisplayName        string         `json:"display_name" gorm:"type:varchar(128);not null"`
	ProviderKey        string         `json:"provider_key" gorm:"type:varchar(64);not null"`
	ProviderLabel      string         `json:"provider_label" gorm:"type:varchar(128);not null"`
	DescriptionEN      string         `json:"description_en" gorm:"type:text;not null"`
	DescriptionZhCN    string         `json:"description_zh_cn" gorm:"type:text;not null"`
	Category           string         `json:"category" gorm:"type:varchar(64);not null;index"`
	Capabilities       JSONStringList `json:"capabilities" gorm:"type:text;not null"`
	InputModalities    JSONStringList `json:"input_modalities" gorm:"type:text;not null"`
	OutputModalities   JSONStringList `json:"output_modalities" gorm:"type:text;not null"`
	ContextLabel       string         `json:"context_label" gorm:"type:varchar(128);not null;default:''"`
	ContextTokens      int            `json:"context_tokens" gorm:"not null;default:0"`
	IconKey            string         `json:"icon_key" gorm:"type:varchar(64);not null;default:'platform'"`
	BadgeKey           string         `json:"badge_key" gorm:"type:varchar(64);not null;default:''"`
	AvailabilityStatus string         `json:"availability_status" gorm:"type:varchar(32);not null;index"`
	Visibility         string         `json:"visibility" gorm:"type:varchar(16);not null;index"`
	ShowInPricing      bool           `json:"show_in_pricing" gorm:"not null;default:false"`
	ShowInPlayground   bool           `json:"show_in_playground" gorm:"not null;default:false"`
	APIEnabled         bool           `json:"api_enabled" gorm:"not null;default:false"`
	Recommended        bool           `json:"recommended" gorm:"not null;default:false"`
	SortOrder          int            `json:"sort_order" gorm:"not null;default:0;index"`
	// SyncSource/SyncBatchID identify rows written by an automated sync (e.g.
	// "openrouter") so a batch can be queried and rolled back. Empty for rows
	// created any other way (admin UI, seed scripts). A sync run MUST leave
	// both untouched on rows it only updates, not just inserts, so re-running
	// it never retags a pre-existing admin-authored row as its own.
	SyncSource  string         `json:"sync_source" gorm:"type:varchar(64);not null;default:'';index"`
	SyncBatchID string         `json:"sync_batch_id" gorm:"type:varchar(64);not null;default:''"`
	CreatedAt   int64          `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64          `json:"updated_at" gorm:"autoUpdateTime"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

func (PlatformModelCatalog) TableName() string { return "platform_model_catalog" }

func ValidatePlatformModelCatalog(catalog *PlatformModelCatalog) error {
	if catalog == nil {
		return errors.New("model catalog entry is required")
	}
	catalog.PublicModelID = strings.TrimSpace(catalog.PublicModelID)
	catalog.DisplayName = strings.TrimSpace(catalog.DisplayName)
	catalog.ProviderKey = strings.TrimSpace(catalog.ProviderKey)
	catalog.ProviderLabel = strings.TrimSpace(catalog.ProviderLabel)
	catalog.DescriptionEN = strings.TrimSpace(catalog.DescriptionEN)
	catalog.DescriptionZhCN = strings.TrimSpace(catalog.DescriptionZhCN)
	catalog.Category = strings.TrimSpace(catalog.Category)
	catalog.ContextLabel = strings.TrimSpace(catalog.ContextLabel)
	catalog.IconKey = strings.TrimSpace(catalog.IconKey)
	catalog.BadgeKey = strings.TrimSpace(catalog.BadgeKey)
	catalog.SyncSource = strings.TrimSpace(catalog.SyncSource)
	catalog.SyncBatchID = strings.TrimSpace(catalog.SyncBatchID)
	if !platformModelIDPattern.MatchString(catalog.PublicModelID) {
		return errors.New("public_model_id must be 3-128 lowercase letters, numbers, dots, underscores, or hyphens")
	}
	if catalog.DisplayName == "" || catalog.ProviderLabel == "" || catalog.DescriptionEN == "" || catalog.DescriptionZhCN == "" {
		return errors.New("display_name, provider_label, description_en, and description_zh_cn are required")
	}
	if !platformModelKeyPattern.MatchString(catalog.ProviderKey) || !platformModelKeyPattern.MatchString(catalog.Category) {
		return errors.New("provider_key and category must be lowercase identifier keys")
	}
	if !isPlatformAvailability(catalog.AvailabilityStatus) {
		return errors.New("invalid availability_status")
	}
	if catalog.Visibility != PlatformModelVisibilityPublic && catalog.Visibility != PlatformModelVisibilityHidden {
		return errors.New("invalid visibility")
	}
	if catalog.SortOrder < 0 || catalog.SortOrder > 1_000_000 {
		return errors.New("sort_order must be between 0 and 1000000")
	}
	if catalog.ContextTokens < 0 || catalog.ContextTokens > maxPlatformContextTokens {
		return errors.New("context_tokens must be between 0 and 100000000")
	}
	if containsMarkup(catalog.DisplayName, catalog.ProviderLabel, catalog.DescriptionEN, catalog.DescriptionZhCN, catalog.ContextLabel, catalog.SyncBatchID) {
		return errors.New("display text must not contain HTML markup")
	}
	if catalog.SyncSource != "" && !platformModelKeyPattern.MatchString(catalog.SyncSource) {
		return errors.New("sync_source must be empty or a lowercase identifier key")
	}
	if len(catalog.SyncBatchID) > 64 {
		return errors.New("sync_batch_id must be at most 64 characters")
	}
	if err := validatePlatformList("capabilities", catalog.Capabilities, platformCapabilityKeys); err != nil {
		return err
	}
	if err := validatePlatformList("input_modalities", catalog.InputModalities, platformModalityKeys); err != nil {
		return err
	}
	if err := validatePlatformList("output_modalities", catalog.OutputModalities, platformModalityKeys); err != nil {
		return err
	}
	if catalog.IconKey == "" {
		catalog.IconKey = "platform"
	}
	if _, ok := platformIconKeys[catalog.IconKey]; !ok {
		return errors.New("invalid icon_key")
	}
	if _, ok := platformBadgeKeys[catalog.BadgeKey]; !ok {
		return errors.New("invalid badge_key")
	}
	return nil
}

var platformCapabilityKeys = map[string]struct{}{
	"chat": {}, "streaming": {}, "reasoning": {}, "tools": {}, "json_mode": {},
	"structured_output": {}, "vision": {}, "embeddings": {}, "audio": {}, "image": {}, "video": {},
}
var platformModalityKeys = map[string]struct{}{"text": {}, "image": {}, "audio": {}, "video": {}, "file": {}}
var platformIconKeys = map[string]struct{}{"platform": {}, "sparkles": {}, "brain": {}, "code": {}, "image": {}, "audio": {}, "video": {}, "embedding": {}}
var platformBadgeKeys = map[string]struct{}{"": {}, "preview": {}, "recommended": {}, "new": {}}

func isPlatformAvailability(value string) bool {
	switch value {
	case PlatformModelAvailabilityAvailable, PlatformModelAvailabilityPreview, PlatformModelAvailabilityMaintenance, PlatformModelAvailabilityComingSoon, PlatformModelAvailabilityDisabled:
		return true
	default:
		return false
	}
}

func containsMarkup(values ...string) bool {
	for _, value := range values {
		if strings.ContainsAny(value, "<>") {
			return true
		}
	}
	return false
}

func validatePlatformList(field string, values []string, allowed map[string]struct{}) error {
	seen := make(map[string]struct{}, len(values))
	for i, value := range values {
		value = strings.TrimSpace(value)
		if _, ok := allowed[value]; !ok {
			return fmt.Errorf("invalid %s value", field)
		}
		if _, ok := seen[value]; ok {
			return fmt.Errorf("duplicate %s value", field)
		}
		seen[value] = struct{}{}
		values[i] = value
	}
	return nil
}

func ListPlatformModelCatalog() ([]PlatformModelCatalog, error) {
	var entries []PlatformModelCatalog
	err := DB.Order("sort_order ASC, id ASC").Find(&entries).Error
	return entries, err
}

// ListPlatformModelCatalogBySyncBatch returns only rows originally created by
// one automated sync batch. Rows created through the admin UI have an empty
// source/batch and are therefore never returned as rollback candidates.
func ListPlatformModelCatalogBySyncBatch(syncSource, syncBatchID string) ([]PlatformModelCatalog, error) {
	var entries []PlatformModelCatalog
	err := DB.Where("sync_source = ? AND sync_batch_id = ?", syncSource, syncBatchID).
		Order("public_model_id ASC").
		Find(&entries).Error
	return entries, err
}

func GetPlatformModelCatalogByID(id int) (*PlatformModelCatalog, error) {
	var entry PlatformModelCatalog
	err := DB.First(&entry, id).Error
	return &entry, err
}

func GetPlatformModelCatalogByPublicID(publicModelID string) (*PlatformModelCatalog, error) {
	var entry PlatformModelCatalog
	err := DB.Where("public_model_id = ?", publicModelID).First(&entry).Error
	return &entry, err
}

func CreatePlatformModelCatalog(entry *PlatformModelCatalog) error {
	if err := ValidatePlatformModelCatalog(entry); err != nil {
		return err
	}
	return DB.Create(entry).Error
}

func UpdatePlatformModelCatalog(entry *PlatformModelCatalog) error {
	if err := ValidatePlatformModelCatalog(entry); err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var existing PlatformModelCatalog
		if err := tx.First(&existing, entry.ID).Error; err != nil {
			return err
		}
		entry.CreatedAt = existing.CreatedAt
		return tx.Save(entry).Error
	})
}

func ArchivePlatformModelCatalog(id int) error {
	result := DB.Delete(&PlatformModelCatalog{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func SeedPlatformModelCatalog(entries []PlatformModelCatalog) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		for i := range entries {
			if err := ValidatePlatformModelCatalog(&entries[i]); err != nil {
				return err
			}
			entries[i].CreatedAt = time.Now().Unix()
			entries[i].UpdatedAt = entries[i].CreatedAt
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "public_model_id"}}, DoNothing: true}).Create(&entries[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

type PlatformModelRouteSummary struct {
	ActiveRouteCount     int
	AccessibleRouteCount int
}

func GetPlatformModelRouteSummary(publicModelID string, usableGroups map[string]string) (PlatformModelRouteSummary, error) {
	var rows []Ability
	err := DB.Model(&Ability{}).
		Select("abilities.*").
		Joins("JOIN channels ON channels.id = abilities.channel_id").
		Where("abilities.model = ? AND abilities.enabled = ? AND channels.status = ?", publicModelID, true, common.ChannelStatusEnabled).
		Scan(&rows).Error
	if err != nil {
		return PlatformModelRouteSummary{}, err
	}
	summary := PlatformModelRouteSummary{ActiveRouteCount: len(rows)}
	for _, row := range rows {
		if row.Group == "all" {
			summary.AccessibleRouteCount++
			continue
		}
		if _, ok := usableGroups[row.Group]; ok {
			summary.AccessibleRouteCount++
		}
	}
	return summary, nil
}
