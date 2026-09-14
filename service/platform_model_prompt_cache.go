package service

// PlatformPromptCacheInfo is public, model-specific prompt-cache guidance. It
// is intentionally a code snapshot rather than catalog data: upstream cache
// thresholds are provider behavior, not administrator-managed metadata.
type PlatformPromptCacheInfo struct {
	MinimumTokens int    `json:"minimum_tokens"`
	Source        string `json:"source"`
	CheckedAt     string `json:"checked_at"`
}

const (
	promptCacheSourceAnthropicDocs = "anthropic-docs"
	promptCacheCheckedAt           = "2026-09-12"
)

// promptCacheByPublicModelID was checked against
// https://platform.claude.com/docs/en/build-with-claude/prompt-caching on
// 2026-09-12. Anthropic updates require a manual review and sync here.
//
// Anthropic's current values for claude-opus-4.7 (2048) and claude-opus-4.8
// (1024) conflict with OpenRouter's older 4096-token table. Anthropic is the
// source of truth adopted here.
var promptCacheByPublicModelID = map[string]PlatformPromptCacheInfo{
	"claude-fable-5":    {MinimumTokens: 512, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-fable-5.1":  {MinimumTokens: 512, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-haiku-4.5":  {MinimumTokens: 4096, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-opus-4":     {MinimumTokens: 1024, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-opus-4.1":   {MinimumTokens: 1024, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-opus-4.5":   {MinimumTokens: 4096, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-opus-4.7":   {MinimumTokens: 2048, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-opus-4.8":   {MinimumTokens: 1024, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-opus-5":     {MinimumTokens: 512, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-sonnet-4":   {MinimumTokens: 1024, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-sonnet-4.5": {MinimumTokens: 1024, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-sonnet-4.6": {MinimumTokens: 1024, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
	"claude-sonnet-5":   {MinimumTokens: 1024, Source: promptCacheSourceAnthropicDocs, CheckedAt: promptCacheCheckedAt},
}

func promptCacheInfo(publicModelID string) *PlatformPromptCacheInfo {
	info, ok := promptCacheByPublicModelID[publicModelID]
	if !ok {
		return nil
	}
	return &info
}
