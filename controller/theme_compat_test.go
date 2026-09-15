package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateOptionRejectsRetiredFrontendTheme(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(`{"key":"theme.frontend","value":"classic"}`),
	)

	UpdateOption(context)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.JSONEq(t, `{"success":false,"message":"Classic 前端已移除，主题只能设置为 default"}`, response.Body.String())
}

func TestGetStatusAdvertisesDefaultDashboard(t *testing.T) {
	t.Setenv("SOURCE_CODE_URL", "")
	t.Setenv("LICENSE_NOTICE_URL", "")
	t.Setenv("PRICING_STATUS", "provisional")
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousMap })
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	var payload struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.True(t, payload.Success)
	assert.Equal(t, "default", payload.Data["theme"])
	assert.Equal(t, "HYC AI", payload.Data["system_name"])
	assert.Equal(t, "provisional", payload.Data["pricing_status"])
	compliance, ok := payload.Data["compliance"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "New API", compliance["upstream_project_name"])
	assert.Equal(t, "https://github.com/QuantumNous/new-api", compliance["upstream_project_url"])
	assert.Equal(t, "Frontend design and development by New API contributors.", compliance["attribution_notice"])
	assert.Equal(t, "AGPL-3.0", compliance["license_name"])
	assert.Empty(t, compliance["source_code_url"])
}
