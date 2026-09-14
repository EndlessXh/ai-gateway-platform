// Package platform holds product-specific configuration that is additive to
// upstream New API.
package platform

import (
	"os"
	"strings"
)

const DefaultProductName = "HYC AI"

// ResolveProductName applies the platform brand precedence: an administrator
// override wins, then the deployment default, then the safe product fallback.
// The upstream default is never reused as ordinary product branding.
func ResolveProductName(adminName string) string {
	adminName = strings.TrimSpace(adminName)
	if adminName != "" && adminName != "New API" && adminName != "NewAPI" {
		return adminName
	}

	if deploymentName := strings.TrimSpace(os.Getenv("PLATFORM_BRAND_NAME")); deploymentName != "" {
		return deploymentName
	}

	return DefaultProductName
}
