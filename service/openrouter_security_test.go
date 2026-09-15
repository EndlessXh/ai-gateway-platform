package service

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestOpenRouterPrivateResponseHeadersAreRemoved(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("channel_type", constant.ChannelTypeOpenRouter)
	privateHeaders := []string{
		"X-OpenRouter-Provider", "x-openrouter-generation-id", "X-Generation-Id",
		"X-Request-Id", "X-Upstream-Request-Id", "Server", "Via", "CF-Ray",
	}
	for _, header := range privateHeaders {
		assert.False(t, ShouldCopyUpstreamHeader(c, header, []string{"private"}), header)
	}
	assert.True(t, ShouldCopyUpstreamHeader(c, "Content-Type", []string{"application/json"}))
}

func TestOpenRouterPublicErrorClassification(t *testing.T) {
	tests := map[int]string{
		http.StatusUnauthorized:       "authentication",
		http.StatusPaymentRequired:    "credits",
		http.StatusForbidden:          "forbidden",
		http.StatusRequestTimeout:     "timed out",
		http.StatusTooManyRequests:    "rate limit",
		http.StatusBadGateway:         "bad gateway",
		http.StatusServiceUnavailable: "unavailable",
	}
	for status, expected := range tests {
		message := OpenRouterPublicErrorMessage(status)
		assert.Contains(t, message, expected)
		assert.NotContains(t, message, "OpenRouter")
		assert.NotContains(t, message, "openrouter.ai")
		assert.NotContains(t, message, "anthropic/")
	}
}

func TestNormalizeRetryAfter(t *testing.T) {
	assert.Equal(t, "17", NormalizeRetryAfter(" 17 "))
	assert.Equal(t, "Wed, 21 Oct 2015 07:28:00 GMT", NormalizeRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT"))
	assert.Empty(t, NormalizeRetryAfter("not-a-retry-value"))
	assert.Empty(t, NormalizeRetryAfter("-1"))
}
