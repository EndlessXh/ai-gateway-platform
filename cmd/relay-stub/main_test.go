package main

import (
	"bufio"
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStubChatAndErrorsAreDeterministic(t *testing.T) {
	server := httptest.NewServer(newStubHandler(&stubState{}))
	t.Cleanup(server.Close)

	tests := []struct {
		name       string
		content    string
		wantStatus int
		wantText   string
		wantRetry  string
	}{
		{name: "chat", content: "hello", wantStatus: http.StatusOK, wantText: "LOCAL_SMOKE_OK"},
		{name: "unauthorized", content: "STUB_401", wantStatus: http.StatusUnauthorized, wantText: "private stub authentication detail"},
		{name: "rate limit", content: "STUB_429", wantStatus: http.StatusTooManyRequests, wantText: "private stub rate-limit detail", wantRetry: "7"},
		{name: "server error", content: "STUB_500", wantStatus: http.StatusInternalServerError, wantText: "private stub internal detail"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := `{"model":"public","messages":[{"role":"user","content":"` + test.content + `"}]}`
			response, err := http.Post(server.URL+"/v1/chat/completions", "application/json", strings.NewReader(body))
			require.NoError(t, err)
			defer response.Body.Close()
			payload, err := io.ReadAll(response.Body)
			require.NoError(t, err)
			assert.Equal(t, test.wantStatus, response.StatusCode)
			assert.Contains(t, string(payload), test.wantText)
			assert.Equal(t, test.wantRetry, response.Header.Get("Retry-After"))
		})
	}
}

func TestStubSSEIncludesUsageAndDone(t *testing.T) {
	server := httptest.NewServer(newStubHandler(&stubState{}))
	t.Cleanup(server.Close)

	body := []byte(`{"stream":true,"messages":[{"role":"user","content":"hello"}]}`)
	response, err := http.Post(server.URL+"/v1/chat/completions", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)

	scanner := bufio.NewScanner(response.Body)
	var data []string
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "data: ") {
			data = append(data, strings.TrimPrefix(scanner.Text(), "data: "))
		}
	}
	require.NoError(t, scanner.Err())
	assert.GreaterOrEqual(t, len(data), 4)
	assert.Contains(t, strings.Join(data, ""), `"total_tokens":11`)
	assert.Equal(t, "[DONE]", data[len(data)-1])
}

func TestStubAnthropicMessagesSupportsBufferedAndSSE(t *testing.T) {
	server := httptest.NewServer(newStubHandler(&stubState{}))
	t.Cleanup(server.Close)

	buffered, err := http.Post(server.URL+"/v1/messages", "application/json", strings.NewReader(`{"model":"public","stream":false}`))
	require.NoError(t, err)
	bufferedBody, err := io.ReadAll(buffered.Body)
	require.NoError(t, err)
	require.NoError(t, buffered.Body.Close())
	assert.Equal(t, http.StatusOK, buffered.StatusCode)
	assert.Contains(t, string(bufferedBody), "LOCAL_CLAUDE_STUB_OK")

	streamed, err := http.Post(server.URL+"/v1/messages", "application/json", strings.NewReader(`{"model":"public","stream":true}`))
	require.NoError(t, err)
	streamedBody, err := io.ReadAll(streamed.Body)
	require.NoError(t, err)
	require.NoError(t, streamed.Body.Close())
	assert.Equal(t, http.StatusOK, streamed.StatusCode)
	assert.Contains(t, string(streamedBody), "event: message_start")
	assert.Contains(t, string(streamedBody), "LOCAL_CLAUDE_STUB_OK")
	assert.Contains(t, string(streamedBody), "event: message_stop")
}

func TestStubAnthropicMessagesRecordsOnlySafeRequestShape(t *testing.T) {
	state := &stubState{}
	server := httptest.NewServer(newStubHandler(state))
	t.Cleanup(server.Close)

	body := `{"model":"claude-opus-4.6","max_tokens":32,"stream":true,"system":[{"type":"text","text":"private","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":[{"type":"text","text":"secret"}]}],"tools":[{"name":"private_tool","input_schema":{"type":"object"}}],"thinking":{"type":"enabled","budget_tokens":16},"metadata":{"user_id":"private"}}`
	request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/messages", strings.NewReader(body))
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer private-token")
	request.Header.Set("Anthropic-Beta", "private-beta")
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	require.NoError(t, response.Body.Close())

	state.shapeMu.RLock()
	encoded, err := common.Marshal(state.lastShape)
	state.shapeMu.RUnlock()
	require.NoError(t, err)
	shapeText := string(encoded)
	assert.Contains(t, shapeText, `"model":"claude-opus-4.6"`)
	assert.Contains(t, shapeText, `"tools_count":1`)
	assert.Contains(t, shapeText, `"thinking_type":"enabled"`)
	assert.Contains(t, shapeText, `"thinking_budget_present":true`)
	assert.Contains(t, shapeText, `"cache_control_present":true`)
	assert.NotContains(t, shapeText, "private-token")
	assert.NotContains(t, shapeText, "private-beta")
	assert.NotContains(t, shapeText, "private_tool")
	assert.NotContains(t, shapeText, "secret")
}

func TestStubChatRecordsOnlySafeConvertedRequestShape(t *testing.T) {
	state := &stubState{}
	server := httptest.NewServer(newStubHandler(state))
	t.Cleanup(server.Close)

	body := `{"model":"private-upstream-model","max_tokens":4096,"stream":true,"messages":[{"role":"system","content":[{"type":"text","text":"private","cache_control":{"type":"ephemeral"}}]},{"role":"user","content":"secret"}],"tools":[{"type":"function","function":{"name":"private_tool"}}],"reasoning":{"enabled":true,"max_tokens":1024},"provider":{"data_collection":"deny","zdr":true,"require_parameters":true}}`
	request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(body))
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer private-token")
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	require.NoError(t, response.Body.Close())

	state.shapeMu.RLock()
	encoded, err := common.Marshal(state.lastShape)
	state.shapeMu.RUnlock()
	require.NoError(t, err)
	shapeText := string(encoded)
	assert.Contains(t, shapeText, `"format":"openai_chat"`)
	assert.Contains(t, shapeText, `"upstream_model_present":true`)
	assert.Contains(t, shapeText, `"system_messages":1`)
	assert.Contains(t, shapeText, `"reasoning_budget_present":true`)
	assert.Contains(t, shapeText, `"provider_data_collection":"deny"`)
	assert.NotContains(t, shapeText, "private-upstream-model")
	assert.NotContains(t, shapeText, "private-token")
	assert.NotContains(t, shapeText, "private_tool")
	assert.NotContains(t, shapeText, "secret")
}
