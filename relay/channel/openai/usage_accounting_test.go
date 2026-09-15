package openai

import (
	"bytes"
	"io"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOpenaiHandlerUsesUpstreamUsageVerbatim pins the billing-safety invariant
// that when upstream reports usage, the billed token counts must be exactly
// those numbers — never re-derived or rounded through a local estimator.
func TestOpenaiHandlerUsesUpstreamUsageVerbatim(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	body := `{"id":"gen-1","model":"anthropic/claude-opus-4.6","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":37,"completion_tokens":52,"total_tokens":89}}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(body)), Header: http.Header{"Content-Type": []string{"application/json"}}}

	usage, apiErr := OpenaiHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 37, usage.PromptTokens)
	assert.Equal(t, 52, usage.CompletionTokens)
	assert.Equal(t, 89, usage.TotalTokens)
	assert.False(t, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens),
		"real upstream usage must not be flagged as a local estimate")
}

// TestOpenaiHandlerFlagsLocallyEstimatedUsage covers the one path that was
// silently unflagged: when upstream sends no usage object at all, the handler
// falls back to counting the real delivered content locally. The token count
// itself is a genuine count of real content, not a guess, but it must be
// marked as locally-derived so admin logs do not read it as upstream-reported.
func TestOpenaiHandlerFlagsLocallyEstimatedUsage(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	info.SetEstimatePromptTokens(20)
	body := `{"id":"gen-2","model":"anthropic/claude-opus-4.6","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"a somewhat longer reply so the local tokenizer has real content to count"},"finish_reason":"stop"}]}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(body)), Header: http.Header{"Content-Type": []string{"application/json"}}}

	usage, apiErr := OpenaiHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 20, usage.PromptTokens)
	assert.Greater(t, usage.CompletionTokens, 0, "must count the real delivered content, not report zero")
	assert.True(t, common.GetContextKeyBool(c, constant.ContextKeyLocalCountTokens),
		"locally-derived usage must be flagged so it is distinguishable from upstream-reported usage in admin logs")
}
