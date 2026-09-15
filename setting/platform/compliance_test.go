package platform

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAttributionIsNotConfigurable pins the rule that brand configuration can
// never blank a licence notice. If someone later turns these constants into
// environment variables, a misconfigured deployment becomes a licence
// violation, so this test exists to make that change deliberate.
func TestAttributionIsNotConfigurable(t *testing.T) {
	t.Setenv("SOURCE_CODE_URL", "")
	t.Setenv("LICENSE_NOTICE_URL", "")

	c := LoadCompliance()

	require.Equal(t, "New API", c.UpstreamProjectName)
	require.Equal(t, "https://github.com/QuantumNous/new-api", c.UpstreamProjectURL)
	require.Equal(t, "Frontend design and development by New API contributors.", c.AttributionNotice)
	require.Equal(t, "AGPL-3.0", c.LicenseName)
}

func TestLaunchBlockers(t *testing.T) {
	tests := []struct {
		name        string
		sourceURL   string
		wantBlocked bool
		wantReason  string
	}{
		{
			name:        "unset is blocked",
			sourceURL:   "",
			wantBlocked: true,
			wantReason:  "section 13",
		},
		{
			name:        "example.com placeholder is blocked",
			sourceURL:   "https://source.example.com/ai-gateway",
			wantBlocked: true,
			wantReason:  "placeholder",
		},
		{
			name:        "replace_me placeholder is blocked",
			sourceURL:   "https://REPLACE_ME/source",
			wantBlocked: true,
			wantReason:  "placeholder",
		},
		{
			name:        "localhost is blocked",
			sourceURL:   "https://localhost/source",
			wantBlocked: true,
			wantReason:  "placeholder",
		},
		{
			name:        "plain http is blocked",
			sourceURL:   "http://source.mygateway.test/repo",
			wantBlocked: true,
			wantReason:  "valid absolute",
		},
		{
			name:        "bare https scheme is blocked",
			sourceURL:   "https://",
			wantBlocked: true,
			wantReason:  "valid absolute https URL",
		},
		{
			name:        "userinfo disguise is blocked",
			sourceURL:   "https://git.mygateway.test@attacker.test/source",
			wantBlocked: true,
			wantReason:  "valid absolute https URL",
		},
		{
			name:        "encoded invalid host is blocked",
			sourceURL:   "https://%20/source",
			wantBlocked: true,
			wantReason:  "valid absolute https URL",
		},
		{
			name:        "real https url passes",
			sourceURL:   "https://git.mygateway.test/platform/ai-gateway",
			wantBlocked: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("SOURCE_CODE_URL", tt.sourceURL)
			c := LoadCompliance()

			blockers := c.LaunchBlockers()

			if !tt.wantBlocked {
				assert.Empty(t, blockers)
				assert.True(t, c.IsPubliclyReady())
				return
			}

			require.NotEmpty(t, blockers)
			assert.False(t, c.IsPubliclyReady())
			assert.Contains(t, blockers[0], tt.wantReason)
		})
	}
}

// Whitespace-only configuration is the same as unset. Without trimming, a
// stray space in an env file would satisfy a non-empty check.
func TestWhitespaceSourceURLIsTreatedAsUnset(t *testing.T) {
	t.Setenv("SOURCE_CODE_URL", "   ")

	blockers := LoadCompliance().LaunchBlockers()

	require.Len(t, blockers, 1)
	assert.Contains(t, blockers[0], "section 13")
}
