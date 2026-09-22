package openai

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	openRouterPublicModel   = "claude-opus-4.6"
	openRouterUpstreamModel = "anthropic/claude-opus-4.6"
)

func openRouterTestInfo(format types.RelayFormat, mode int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		OriginModelName: openRouterPublicModel,
		RelayFormat:     format,
		RelayMode:       mode,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenRouter,
			ChannelBaseUrl:    "https://openrouter.ai/api",
			UpstreamModelName: openRouterUpstreamModel,
		},
	}
}

func openRouterTestContext(t *testing.T, path string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, path, nil)
	c.Set(common.RequestIdKey, "local-request")
	c.Set("channel_type", constant.ChannelTypeOpenRouter)
	return c, recorder
}

func TestOpenRouterRequestURLUsesSingleV1Segment(t *testing.T) {
	tests := []struct {
		name   string
		format types.RelayFormat
		mode   int
		path   string
	}{
		{name: "chat", format: types.RelayFormatOpenAI, mode: relayconstant.RelayModeChatCompletions, path: "/v1/chat/completions"},
		{name: "messages via chat", format: types.RelayFormatClaude, mode: relayconstant.RelayModeChatCompletions, path: "/v1/messages"},
		{name: "responses", format: types.RelayFormatOpenAIResponses, mode: relayconstant.RelayModeResponses, path: "/v1/responses"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			info := openRouterTestInfo(test.format, test.mode)
			info.RequestURLPath = test.path
			url, err := (&Adaptor{}).GetRequestURL(info)
			require.NoError(t, err)
			expectedPath := test.path
			if test.format == types.RelayFormatClaude {
				expectedPath = "/v1/chat/completions"
			}
			assert.Equal(t, "https://openrouter.ai/api"+expectedPath, url)
			assert.NotContains(t, url, "/v1/v1/")
		})
	}
}

func TestOpenRouterAdapterEnforcesCostFirstProviderPolicy(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	request := &dto.GeneralOpenAIRequest{Provider: common.StringToByteSlice(`{"order":["untrusted"],"sort":"throughput","allow_fallbacks":false,"max_price":{"prompt":1}}`)}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, request)
	require.NoError(t, err)
	chat := converted.(*dto.GeneralOpenAIRequest)
	assertProviderCostFirstPolicy(t, chat.Provider)
	assertProviderKeepsMaxPrice(t, chat.Provider)

	responses, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(c, info, dto.OpenAIResponsesRequest{
		Provider: common.StringToByteSlice(`{"order":["untrusted"],"sort":"throughput","allow_fallbacks":false,"max_price":{"prompt":1}}`),
	})
	require.NoError(t, err)
	assertProviderCostFirstPolicy(t, responses.(dto.OpenAIResponsesRequest).Provider)
	assertProviderKeepsMaxPrice(t, responses.(dto.OpenAIResponsesRequest).Provider)
}

func TestOpenRouterAdapterAllowsDataRetentionWhenChannelOptsIn(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	info.ChannelOtherSettings.AllowOpenRouterDataRetention = true
	request := &dto.GeneralOpenAIRequest{Provider: common.StringToByteSlice(`{"order":["untrusted"]}`)}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, request)
	require.NoError(t, err)
	chat := converted.(*dto.GeneralOpenAIRequest)
	assertProviderAllowsDataRetention(t, chat.Provider)

	responses, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(c, info, dto.OpenAIResponsesRequest{
		Provider: common.StringToByteSlice(`{"order":["untrusted"]}`),
	})
	require.NoError(t, err)
	assertProviderAllowsDataRetention(t, responses.(dto.OpenAIResponsesRequest).Provider)
}

func TestOpenRouterAdapterDisablesMetadataHeaders(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	header := http.Header{
		"HTTP-Referer":       []string{"https://untrusted.example"},
		"X-OpenRouter-Title": []string{"untrusted"},
	}

	require.NoError(t, (&Adaptor{}).SetupRequestHeader(c, &header, info))
	assert.Empty(t, header.Get("HTTP-Referer"))
	assert.Empty(t, header.Get("X-OpenRouter-Title"))
	assert.Equal(t, "disabled", header.Get("X-OpenRouter-Metadata"))
}

func TestOpenRouterAdapterDoesNotForwardClaudeClientHeaders(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/messages")
	c.Request.Header.Set("Authorization", "Bearer client-secret")
	c.Request.Header.Set("X-Api-Key", "client-secret")
	c.Request.Header.Set("Anthropic-Beta", "private-beta")
	c.Request.Header.Set("X-Claude-Code-Session-Id", "private-session")
	c.Request.Header.Set("X-Stainless-Runtime", "private-runtime")
	info := openRouterTestInfo(types.RelayFormatClaude, relayconstant.RelayModeChatCompletions)
	info.ApiKey = "channel-secret"
	header := http.Header{}

	require.NoError(t, (&Adaptor{}).SetupRequestHeader(c, &header, info))
	assert.Equal(t, "Bearer channel-secret", header.Get("Authorization"))
	assert.Empty(t, header.Get("X-Api-Key"))
	assert.Empty(t, header.Get("Anthropic-Beta"))
	assert.Empty(t, header.Get("X-Claude-Code-Session-Id"))
	assert.Empty(t, header.Get("X-Stainless-Runtime"))
}

func TestOpenRouterModelMappingKeepsPublicAliasAtBoundary(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	c.Set("model_mapping", `{"claude-opus-4.6":"anthropic/claude-opus-4.6"}`)
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	request := &dto.GeneralOpenAIRequest{Model: openRouterPublicModel}

	require.NoError(t, helper.ModelMappedHelper(c, info, request))
	assert.Equal(t, openRouterPublicModel, info.OriginModelName)
	assert.Equal(t, openRouterUpstreamModel, info.UpstreamModelName)
	assert.Equal(t, openRouterUpstreamModel, request.Model)
}

func assertProviderPrivacyPolicy(t *testing.T, raw []byte) {
	t.Helper()
	var provider map[string]any
	require.NoError(t, common.Unmarshal(raw, &provider))
	assert.Equal(t, "deny", provider["data_collection"])
	assert.Equal(t, true, provider["zdr"])
	assert.Equal(t, true, provider["require_parameters"])
	assert.Equal(t, "price", provider["sort"])
	assert.Equal(t, true, provider["allow_fallbacks"])
	assert.NotContains(t, provider, "order")
}

func assertProviderAllowsDataRetention(t *testing.T, raw []byte) {
	t.Helper()
	var provider map[string]any
	require.NoError(t, common.Unmarshal(raw, &provider))
	assert.NotContains(t, provider, "data_collection")
	assert.NotContains(t, provider, "zdr")
	assert.Equal(t, true, provider["require_parameters"])
	assert.Equal(t, "price", provider["sort"])
	assert.Equal(t, true, provider["allow_fallbacks"])
	assert.NotContains(t, provider, "order")
}

func assertProviderCostFirstPolicy(t *testing.T, raw []byte) {
	t.Helper()
	var provider map[string]any
	require.NoError(t, common.Unmarshal(raw, &provider))
	assert.Equal(t, "price", provider["sort"])
	assert.Equal(t, true, provider["allow_fallbacks"])
	assert.Equal(t, true, provider["require_parameters"])
	assert.Equal(t, "deny", provider["data_collection"])
	assert.Equal(t, true, provider["zdr"])
	assert.NotContains(t, provider, "order")
	assert.NotContains(t, provider, "only")
	assert.NotContains(t, provider, "ignore")
}

func assertProviderKeepsMaxPrice(t *testing.T, raw []byte) {
	t.Helper()
	var provider map[string]any
	require.NoError(t, common.Unmarshal(raw, &provider))
	assert.Equal(t, map[string]any{"prompt": float64(1)}, provider["max_price"])
}

func TestOpenRouterAdapterCreatesProviderPolicyWhenAbsent(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, &dto.GeneralOpenAIRequest{})
	require.NoError(t, err)
	assertProviderCostFirstPolicy(t, converted.(*dto.GeneralOpenAIRequest).Provider)
}

func TestNonOpenRouterAdapterLeavesProviderPolicyUntouched(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	info.ChannelType = constant.ChannelTypeOpenAI
	request := &dto.GeneralOpenAIRequest{Provider: common.StringToByteSlice(`{"sort":"throughput","allow_fallbacks":false}`)}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, request)
	require.NoError(t, err)
	assert.JSONEq(t, `{"sort":"throughput","allow_fallbacks":false}`, string(converted.(*dto.GeneralOpenAIRequest).Provider))
}

func TestOpenRouterChatResponsesHideUpstreamIdentity(t *testing.T) {
	c, recorder := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	body := `{"id":"gen-upstream","model":"anthropic/claude-opus-4.6","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok","reasoning_details":[{"type":"reasoning.text","text":"r"}]},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2},"provider":"Anthropic"}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{
		"Content-Type":       []string{"application/json"},
		"X-OpenRouter-Trace": []string{"private"},
		"X-Generation-Id":    []string{"gen-upstream"},
	}}

	usage, apiErr := OpenaiHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	var output map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &output))
	assert.Equal(t, openRouterPublicModel, output["model"])
	assert.Equal(t, helper.GetResponseID(c), output["id"])
	assert.NotContains(t, output, "provider")
	assert.NotContains(t, recorder.Body.String(), openRouterUpstreamModel)
	assert.Empty(t, recorder.Header().Get("X-OpenRouter-Trace"))
	assert.Empty(t, recorder.Header().Get("X-Generation-Id"))
	assert.Contains(t, recorder.Body.String(), "reasoning_details")
}

func TestOpenRouterMessagesResponseUsesPublicModel(t *testing.T) {
	c, recorder := openRouterTestContext(t, "/v1/messages")
	info := openRouterTestInfo(types.RelayFormatClaude, relayconstant.RelayModeChatCompletions)
	body := `{"id":"gen-upstream","model":"anthropic/claude-opus-4.6","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{"Content-Type": []string{"application/json"}}}

	_, apiErr := OpenaiHandler(c, info, resp)
	require.Nil(t, apiErr)
	var output map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &output))
	assert.Equal(t, openRouterPublicModel, output["model"])
	assert.NotContains(t, recorder.Body.String(), openRouterUpstreamModel)
}

func TestOpenRouterChatStreamChunkUsesPublicIdentity(t *testing.T) {
	c, recorder := openRouterTestContext(t, "/v1/chat/completions")
	info := openRouterTestInfo(types.RelayFormatOpenAI, relayconstant.RelayModeChatCompletions)
	chunk := `{"id":"gen-upstream","model":"anthropic/claude-opus-4.6","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok","reasoning_details":[{"type":"reasoning.text","text":"r"}]},"finish_reason":null}],"openrouter_metadata":{"provider":"Anthropic"}}`

	require.NoError(t, sendStreamData(c, info, chunk, false, false))
	output := recorder.Body.String()
	assert.Contains(t, output, `"model":"claude-opus-4.6"`)
	assert.Contains(t, output, `"id":"chatcmpl-local-request"`)
	assert.Contains(t, output, "reasoning_details")
	assert.NotContains(t, output, openRouterUpstreamModel)
	assert.NotContains(t, output, "openrouter_metadata")
}

func TestOpenRouterMessagesStreamUsesPublicIdentity(t *testing.T) {
	c, recorder := openRouterTestContext(t, "/v1/messages")
	info := openRouterTestInfo(types.RelayFormatClaude, relayconstant.RelayModeChatCompletions)
	chunk := `{"id":"gen-upstream","model":"anthropic/claude-opus-4.6","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}],"openrouter_metadata":{"provider":"Anthropic"}}`

	require.NoError(t, HandleStreamFormat(c, info, chunk, false, false))
	output := recorder.Body.String()
	assert.Contains(t, output, `"model":"claude-opus-4.6"`)
	assert.Contains(t, output, `"id":"chatcmpl-local-request"`)
	assert.NotContains(t, output, openRouterUpstreamModel)
	assert.NotContains(t, output, "openrouter_metadata")
}

func TestOpenRouterStreamErrorIsSanitizedAndKeepsStatus(t *testing.T) {
	c, _ := openRouterTestContext(t, "/v1/messages")
	info := openRouterTestInfo(types.RelayFormatClaude, relayconstant.RelayModeChatCompletions)
	input := `{"error":{"code":429,"message":"private provider detail","metadata":{"error_type":"rate_limit_exceeded","provider_name":"private"}},"id":"private-id"}`

	output, err := sanitizeOpenRouterChatChunk(c, info, input)
	require.NoError(t, err)
	assert.JSONEq(t, `{"error":{"code":429,"message":"Upstream rate limit exceeded","type":"upstream_error"}}`, output)
	assert.NotContains(t, output, "private")
}

func TestOpenRouterMessagesTerminalStreamErrorUsesClaudeSSEAndFailsBilling(t *testing.T) {
	originalStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = originalStreamingTimeout })
	c, recorder := openRouterTestContext(t, "/v1/messages")
	info := openRouterTestInfo(types.RelayFormatClaude, relayconstant.RelayModeChatCompletions)
	info.IsStream = true
	stream := "data: {\"error\":{\"code\":429,\"message\":\"private provider detail\",\"metadata\":{\"error_type\":\"rate_limit_exceeded\",\"provider_name\":\"private\"}}}\n\n"
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(stream)),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	usage, apiErr := OaiStreamHandler(c, info, resp)
	assert.Nil(t, usage)
	require.NotNil(t, apiErr)
	assert.Equal(t, http.StatusTooManyRequests, apiErr.StatusCode)
	output := recorder.Body.String()
	assert.Contains(t, output, "event: error")
	assert.Contains(t, output, `"type":"rate_limit_error"`)
	assert.Contains(t, output, "Upstream rate limit exceeded")
	assert.NotContains(t, output, "private")
	assert.NotContains(t, output, "upstream_error")
}

func TestOpenRouterResponsesAPIUsesPublicIdentity(t *testing.T) {
	c, recorder := openRouterTestContext(t, "/v1/responses")
	info := openRouterTestInfo(types.RelayFormatOpenAIResponses, relayconstant.RelayModeResponses)
	body := `{"id":"gen-upstream","object":"response","status":"completed","model":"anthropic/claude-opus-4.6","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2},"provider":"Anthropic"}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(body)), Header: http.Header{"Content-Type": []string{"application/json"}}}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	var output map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &output))
	assert.Equal(t, openRouterPublicModel, output["model"])
	assert.Equal(t, "resp_local-request", output["id"])
	assert.NotContains(t, output, "provider")
	assert.NotContains(t, recorder.Body.String(), openRouterUpstreamModel)
}

func TestOpenRouterResponsesStreamUsesPublicIdentity(t *testing.T) {
	c, recorder := openRouterTestContext(t, "/v1/responses")
	info := openRouterTestInfo(types.RelayFormatOpenAIResponses, relayconstant.RelayModeResponses)
	stream := dto.ResponsesStreamResponse{
		Type:           "response.completed",
		Response:       &dto.OpenAIResponsesResponse{ID: "gen-upstream", Model: openRouterUpstreamModel},
		SequenceNumber: 3,
	}
	sendResponsesStreamData(c, info, stream, `{"provider":"Anthropic"}`)
	output := recorder.Body.String()
	assert.Contains(t, output, `"model":"claude-opus-4.6"`)
	assert.Contains(t, output, `"id":"resp_local-request"`)
	assert.Contains(t, output, `"sequence_number":3`)
	assert.NotContains(t, output, openRouterUpstreamModel)
	assert.NotContains(t, output, "provider")
}

func TestOpenRouterResponsesStreamSanitizesErrorAndReturnsFailure(t *testing.T) {
	originalStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = originalStreamingTimeout })
	c, recorder := openRouterTestContext(t, "/v1/responses")
	info := openRouterTestInfo(types.RelayFormatOpenAIResponses, relayconstant.RelayModeResponses)
	stream := "data: {\"type\":\"error\",\"error\":{\"code\":429,\"message\":\"private provider detail\",\"metadata\":{\"provider_name\":\"Anthropic\"}},\"sequence_number\":4}\n\n"
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(stream)),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	usage, apiErr := OaiResponsesStreamHandler(c, info, resp)
	assert.Nil(t, usage)
	require.NotNil(t, apiErr)
	assert.Equal(t, http.StatusTooManyRequests, apiErr.StatusCode)
	output := recorder.Body.String()
	assert.Contains(t, output, `"type":"error"`)
	assert.Contains(t, output, "Upstream rate limit exceeded")
	assert.NotContains(t, output, "private provider detail")
	assert.NotContains(t, output, "Anthropic")
}
