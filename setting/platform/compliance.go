// Package platform holds product-specific configuration that is additive to
// upstream New API. Keeping it in its own package means upstream merges never
// touch it.
//
// This file implements the licence-compliance surface. New API is AGPL-3.0
// with additional terms under Section 7(b) (see NOTICE), and operating it as a
// network service triggers Section 13: users must be offered the Corresponding
// Source of the modified version they are actually talking to.
//
// The attribution values below are deliberately NOT configurable. Brand
// configuration owns the product name, logo and marketing copy; it must never
// be able to blank a legal notice, because a misconfiguration would then
// silently become a licence violation.
package platform

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

const (
	// UpstreamProjectName and UpstreamProjectURL identify the original work.
	// Fixed constants, not environment variables: AGPLv3 §7(b) requires these
	// to be preserved, and §7(c) forbids misrepresenting the software's origin.
	UpstreamProjectName = "New API"
	UpstreamProjectURL  = "https://github.com/QuantumNous/new-api"

	// AttributionNotice is the exact string required by NOTICE. Do not reword.
	AttributionNotice = "Frontend design and development by New API contributors."

	// LicenseName is the licence this combined work is distributed under.
	LicenseName = "AGPL-3.0"
)

// Compliance is the resolved licence-compliance configuration.
type Compliance struct {
	// SourceCodeURL is where users of the running service can obtain the
	// Corresponding Source of THIS modified version. Required in production
	// by AGPLv3 §13. Empty in development is tolerated but is a launch blocker.
	SourceCodeURL string

	// LicenseNoticeURL optionally points at a hosted copy of the licence and
	// notices. Optional: the repository ships LICENSE and NOTICE regardless.
	LicenseNoticeURL string

	// UpstreamProjectName / UpstreamProjectURL are echoed from the constants
	// above so callers have a single struct to render from.
	UpstreamProjectName string
	UpstreamProjectURL  string
	AttributionNotice   string
	LicenseName         string
}

// LoadCompliance reads the compliance configuration from the environment.
//
// Note that only SourceCodeURL and LicenseNoticeURL come from the environment.
// The attribution fields are constants; there is intentionally no env var that
// can override or clear them.
func LoadCompliance() Compliance {
	return Compliance{
		SourceCodeURL:       strings.TrimSpace(os.Getenv("SOURCE_CODE_URL")),
		LicenseNoticeURL:    strings.TrimSpace(os.Getenv("LICENSE_NOTICE_URL")),
		UpstreamProjectName: UpstreamProjectName,
		UpstreamProjectURL:  UpstreamProjectURL,
		AttributionNotice:   AttributionNotice,
		LicenseName:         LicenseName,
	}
}

// LaunchBlockers returns the reasons this configuration must not serve public
// production traffic. An empty slice means the compliance surface is complete.
//
// production=false still reports blockers, so development shows the same list
// rather than hiding it until deployment day.
func (c Compliance) LaunchBlockers() []string {
	var blockers []string

	if c.SourceCodeURL == "" {
		blockers = append(blockers, "SOURCE_CODE_URL is not set: AGPLv3 section 13 requires offering the Corresponding Source to users of a network service")
		return blockers
	}

	// A placeholder is worse than empty: it looks configured while pointing
	// nowhere, so it would pass a naive "is it set" check.
	lowered := strings.ToLower(c.SourceCodeURL)
	for _, bad := range []string{"example.com", "example.invalid", "replace_me", "changeme", "todo", "localhost", "127.0.0.1"} {
		if strings.Contains(lowered, bad) {
			blockers = append(blockers, fmt.Sprintf("SOURCE_CODE_URL looks like a placeholder (%q): it must be a real, publicly reachable location", c.SourceCodeURL))
			return blockers
		}
	}

	parsed, err := url.ParseRequestURI(c.SourceCodeURL)
	if err != nil || parsed == nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Hostname() == "" || parsed.User != nil {
		blockers = append(blockers, fmt.Sprintf("SOURCE_CODE_URL must be a valid absolute https URL without embedded credentials (got %q)", c.SourceCodeURL))
	}

	return blockers
}

// IsPubliclyReady reports whether the compliance surface has no launch blockers.
// It does NOT verify that the URL actually serves the source; that requires a
// human to publish it and confirm.
func (c Compliance) IsPubliclyReady() bool {
	return len(c.LaunchBlockers()) == 0
}
