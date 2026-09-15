package types

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSetMessageReplacesRelayPayloadAndMetadata(t *testing.T) {
	err := WithOpenAIError(OpenAIError{
		Message:  "provider failure at https://openrouter.ai for anthropic/claude-opus-4.6",
		Type:     "upstream_error",
		Code:     "provider_error",
		Metadata: []byte(`{"provider":"anthropic"}`),
	}, http.StatusBadGateway)

	err.SetMessage("Upstream provider returned a bad gateway")
	output := err.ToOpenAIError()
	assert.Equal(t, "Upstream provider returned a bad gateway", output.Message)
	assert.Empty(t, output.Metadata)
	assert.NotContains(t, output.Message, "openrouter")

	claudeErr := WithClaudeError(ClaudeError{Type: "api_error", Message: "private"}, http.StatusBadGateway)
	claudeErr.SetMessage("Upstream provider returned a bad gateway")
	assert.Equal(t, "Upstream provider returned a bad gateway", claudeErr.ToClaudeError().Message)
	assert.True(t, errors.Is(err, err.Err))
}
