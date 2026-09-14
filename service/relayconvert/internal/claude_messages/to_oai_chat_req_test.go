package claudemessages

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClaudeMessagesRequestMapsToolChoice(t *testing.T) {
	tests := []struct {
		name             string
		choice           dto.ClaudeToolChoice
		wantChoice       any
		wantParallelFlag *bool
	}{
		{name: "auto", choice: dto.ClaudeToolChoice{Type: "auto"}, wantChoice: "auto"},
		{name: "any", choice: dto.ClaudeToolChoice{Type: "any"}, wantChoice: "required"},
		{name: "none", choice: dto.ClaudeToolChoice{Type: "none"}, wantChoice: "none"},
		{
			name:             "named tool without parallel calls",
			choice:           dto.ClaudeToolChoice{Type: "tool", Name: "safe_tool", DisableParallelToolUse: true},
			wantChoice:       map[string]any{"type": "function", "function": map[string]string{"name": "safe_tool"}},
			wantParallelFlag: boolPointer(false),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := ClaudeMessagesRequestToOpenAIChat(dto.ClaudeRequest{
				Model:      "claude-opus-4.6",
				ToolChoice: test.choice,
			}, nil)
			require.NoError(t, err)
			assert.Equal(t, test.wantChoice, got.ToolChoice)
			assert.Equal(t, test.wantParallelFlag, got.ParallelTooCalls)
		})
	}
}

func TestClaudeMessagesRequestDoesNotForwardClientMetadataOrContextManagement(t *testing.T) {
	got, err := ClaudeMessagesRequestToOpenAIChat(dto.ClaudeRequest{
		Model:             "claude-opus-4.6",
		Metadata:          json.RawMessage(`{"user_id":"client-only"}`),
		ContextManagement: json.RawMessage(`{"edits":[{"type":"clear_tool_uses_20250919"}]}`),
	}, nil)
	require.NoError(t, err)
	assert.Empty(t, got.Metadata)
	assert.Empty(t, got.ExtraBody)
}

func TestClaudeMessagesRequestPreservesToolsResultsCacheAndThinkingForOpenRouter(t *testing.T) {
	fixture, err := os.ReadFile("testdata/claude-code-request.json")
	require.NoError(t, err)
	var request dto.ClaudeRequest
	require.NoError(t, json.Unmarshal(fixture, &request))
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenRouter, UpstreamModelName: "anthropic/claude-opus-4.6",
	}}

	got, err := ClaudeMessagesRequestToOpenAIChat(request, info)
	require.NoError(t, err)
	require.Len(t, got.Tools, 1)
	assert.Equal(t, "safe_tool", got.Tools[0].Function.Name)
	require.Len(t, got.Messages, 3)
	assert.Equal(t, "system", got.Messages[0].Role)
	require.Len(t, got.Messages[0].ParseContent(), 1)
	assert.JSONEq(t, `{"type":"ephemeral"}`, string(got.Messages[0].ParseContent()[0].CacheControl))
	assert.Equal(t, "assistant", got.Messages[1].Role)
	assert.Equal(t, "tool", got.Messages[2].Role)
	assert.Equal(t, "synthetic-call", got.Messages[2].ToolCallId)
	assert.Empty(t, got.Metadata)
	assert.Empty(t, got.ExtraBody)
	var reasoning map[string]any
	require.NoError(t, common.Unmarshal(got.Reasoning, &reasoning))
	assert.Equal(t, true, reasoning["enabled"])
	assert.Equal(t, float64(1024), reasoning["max_tokens"])
}

func TestClaudeMessagesRequestRejectsInvalidNamedToolChoice(t *testing.T) {
	_, err := ClaudeMessagesRequestToOpenAIChat(dto.ClaudeRequest{
		Model:      "claude-opus-4.6",
		ToolChoice: dto.ClaudeToolChoice{Type: "tool"},
	}, nil)
	require.ErrorContains(t, err, "requires a name")
}

func TestClaudeMessagesRequestPreservesAssistantTextAlongsideToolUse(t *testing.T) {
	var request dto.ClaudeRequest
	require.NoError(t, json.Unmarshal([]byte(`{
		"model":"claude-opus-4.6",
		"messages":[{"role":"assistant","content":[
			{"type":"text","text":"I will look that up."},
			{"type":"tool_use","id":"toolu_1","name":"lookup","input":{"q":"safe"}}
		]}]
	}`), &request))

	got, err := ClaudeMessagesRequestToOpenAIChat(request, nil)
	require.NoError(t, err)
	require.Len(t, got.Messages, 1)
	content := got.Messages[0].ParseContent()
	require.Len(t, content, 1)
	assert.Equal(t, "I will look that up.", content[0].Text)
	toolCalls := got.Messages[0].ParseToolCalls()
	require.Len(t, toolCalls, 1)
	assert.Equal(t, "toolu_1", toolCalls[0].ID)
}

func TestClaudeMessagesRequestPreservesReasoningDetailsForOpenRouterContinuation(t *testing.T) {
	var request dto.ClaudeRequest
	require.NoError(t, json.Unmarshal([]byte(`{
		"model":"claude-opus-4.6",
		"messages":[{"role":"assistant","content":[
			{"type":"thinking","thinking":"private reasoning","signature":"signed"},
			{"type":"redacted_thinking","data":"encrypted-payload"},
			{"type":"text","text":"answer"}
		]}]
	}`), &request))
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenRouter, UpstreamModelName: "anthropic/claude-opus-4.6",
	}}

	got, err := ClaudeMessagesRequestToOpenAIChat(request, info)
	require.NoError(t, err)
	require.Len(t, got.Messages, 1)
	assert.JSONEq(t, `[
		{"type":"reasoning.text","text":"private reasoning","signature":"signed"},
		{"type":"reasoning.encrypted","data":"encrypted-payload"}
	]`, string(got.Messages[0].ReasoningDetails))
	content := got.Messages[0].ParseContent()
	require.Len(t, content, 1)
	assert.Equal(t, "answer", content[0].Text)
}

func TestClaudeMessagesRequestPreservesReasoningOnlyAssistantMessage(t *testing.T) {
	var request dto.ClaudeRequest
	require.NoError(t, json.Unmarshal([]byte(`{
		"model":"claude-opus-4.6",
		"messages":[{"role":"assistant","content":[
			{"type":"redacted_thinking","data":"encrypted-only"}
		]}]
	}`), &request))
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenRouter, UpstreamModelName: "anthropic/claude-opus-4.6",
	}}

	got, err := ClaudeMessagesRequestToOpenAIChat(request, info)
	require.NoError(t, err)
	require.Len(t, got.Messages, 1)
	assert.JSONEq(t, `[{"type":"reasoning.encrypted","data":"encrypted-only"}]`, string(got.Messages[0].ReasoningDetails))
}

func boolPointer(value bool) *bool {
	return &value
}
