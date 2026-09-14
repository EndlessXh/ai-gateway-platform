package channel

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestEnforceOpenRouterPrivateRequestHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://example.test/v1/chat/completions", nil)
	req.Header.Set("HTTP-Referer", "https://untrusted.example")
	req.Header.Set("X-Title", "untrusted")
	req.Header.Set("X-OpenRouter-Title", "untrusted")
	req.Header.Set("X-OpenRouter-Experimental-Metadata", "enabled")
	req.Header.Set("X-OpenRouter-Metadata", "enabled")
	req.Header.Set("X-Session-Id", "untrusted")
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenRouter}}

	enforceOpenRouterPrivateRequestHeaders(req, info)
	assert.Empty(t, req.Header.Get("HTTP-Referer"))
	assert.Empty(t, req.Header.Get("X-Title"))
	assert.Empty(t, req.Header.Get("X-OpenRouter-Title"))
	assert.Empty(t, req.Header.Get("X-OpenRouter-Experimental-Metadata"))
	assert.Empty(t, req.Header.Get("X-Session-Id"))
	assert.Equal(t, "disabled", req.Header.Get("X-OpenRouter-Metadata"))
}

func TestOpenRouterRetryAfterCapturedForErrorRelay(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenRouter}}
	resp := &http.Response{StatusCode: http.StatusTooManyRequests, Header: http.Header{"Retry-After": []string{"23"}}}

	captureOpenRouterRetryAfter(c, info, resp)
	assert.Equal(t, "23", c.GetString(service.UpstreamRetryAfterContextKey))
}
