package helper

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func openRouterRequestContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("channel_type", constant.ChannelTypeOpenRouter)
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	return c
}

func TestOpenRouterRejectsUserRoutingFields(t *testing.T) {
	fields := []string{"provider", "route", "models", "fallbacks", "plugins", "transforms", "debug", "trace", "metadata", "session_id"}
	for _, field := range fields {
		t.Run(field, func(t *testing.T) {
			body := fmt.Sprintf(`{"model":"claude-opus-4.6","messages":[{"role":"user","content":"hi"}],%q:{}}`, field)
			_, err := GetAndValidateRequest(openRouterRequestContext(t, body), types.RelayFormatOpenAI)
			require.Error(t, err)
			assert.Contains(t, strings.ToLower(err.Error()), "not allowed")
			assert.NotContains(t, strings.ToLower(err.Error()), "openrouter")
		})
	}
}

func TestOpenRouterRejectsUserRoutingHeaders(t *testing.T) {
	headers := []string{"X-OpenRouter-Metadata", "X-OpenRouter-Experimental-Metadata", "HTTP-Referer", "X-Title", "X-OpenRouter-Title", "X-Session-Id"}
	for _, header := range headers {
		t.Run(header, func(t *testing.T) {
			c := openRouterRequestContext(t, `{"model":"claude-opus-4.6","messages":[{"role":"user","content":"hi"}]}`)
			c.Request.Header.Set(header, "untrusted")
			_, err := GetAndValidateRequest(c, types.RelayFormatOpenAI)
			require.Error(t, err)
			assert.Contains(t, strings.ToLower(err.Error()), "not allowed")
			assert.NotContains(t, strings.ToLower(err.Error()), "openrouter")
		})
	}
}

func TestOpenRouterAllowsOrdinaryChatRequest(t *testing.T) {
	c := openRouterRequestContext(t, `{"model":"claude-opus-4.6","messages":[{"role":"user","content":"hi"}],"max_tokens":16}`)
	request, err := GetAndValidateRequest(c, types.RelayFormatOpenAI)
	require.NoError(t, err)
	assert.Equal(t, "claude-opus-4.6", request.(*dto.GeneralOpenAIRequest).Model)
}

func TestOpenRouterAllowsClaudeMessagesMetadataButStillRejectsSessionRouting(t *testing.T) {
	withMetadata := openRouterRequestContext(t, `{"model":"claude-opus-4.6","messages":[{"role":"user","content":"hi"}],"max_tokens":16,"metadata":{"user_id":"client-only"}}`)
	withMetadata.Request.URL.Path = "/v1/messages"
	request, err := GetAndValidateRequest(withMetadata, types.RelayFormatClaude)
	require.NoError(t, err)
	assert.NotEmpty(t, request.(*dto.ClaudeRequest).Metadata)

	withSessionRouting := openRouterRequestContext(t, `{"model":"claude-opus-4.6","messages":[{"role":"user","content":"hi"}],"session_id":"untrusted"}`)
	withSessionRouting.Request.URL.Path = "/v1/messages"
	_, err = GetAndValidateRequest(withSessionRouting, types.RelayFormatClaude)
	require.ErrorContains(t, err, `routing control field "session_id" is not allowed`)
}
