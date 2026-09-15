package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

// TestFormatUserLogsStripsUpstreamModelName pins the platform's provider
// isolation rule: a user requests a platform alias, and the log they can read
// back must not disclose which upstream model actually served it. Without this
// the published model catalogue could be contradicted by the user's own logs.
func TestFormatUserLogsStripsUpstreamModelName(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"upstream_model_name": "qwen-plus",
		"is_model_mapped":     true,
		"model_ratio":         0.2,
	})
	logs := []*Log{{
		Other:             other,
		ModelName:         "platform-general-preview",
		ChannelId:         17,
		ChannelName:       "upstream-a-dev",
		UpstreamRequestId: "upstream-request-private",
	}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	require.NotContains(t, parsed, "upstream_model_name", "upstream model must not be exposed in non-admin log views")
	require.Empty(t, logs[0].ChannelName, "internal channel name must not be exposed in non-admin log views")
	require.Zero(t, logs[0].ChannelId, "internal channel id must not be exposed in non-admin log views")
	require.Empty(t, logs[0].UpstreamRequestId, "upstream request id must not be exposed in non-admin log views")
	// The alias the user actually asked for, and their billing inputs, stay visible.
	require.Equal(t, "platform-general-preview", logs[0].ModelName)
	require.Contains(t, parsed, "model_ratio")
}

func TestFormatUserLogsStripsLegacyChannelDetailsFromOther(t *testing.T) {
	logs := []*Log{{Other: common.MapToJsonStr(map[string]interface{}{
		"channel_id":   17,
		"channel_name": "openrouter-private",
		"channel_type": 20,
		"status_code":  502,
	})}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	require.NotContains(t, parsed, "channel_id")
	require.NotContains(t, parsed, "channel_name")
	require.NotContains(t, parsed, "channel_type")
	require.Contains(t, parsed, "status_code")
}
