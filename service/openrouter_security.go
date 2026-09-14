package service

import (
	"net/http"
	"strconv"
	"strings"
)

const UpstreamRetryAfterContextKey = "openrouter_upstream_retry_after"

func OpenRouterPublicErrorMessage(statusCode int) string {
	switch statusCode {
	case http.StatusUnauthorized:
		return "Upstream authentication failed"
	case http.StatusPaymentRequired:
		return "Upstream account has insufficient credits"
	case http.StatusForbidden:
		return "Upstream request was forbidden"
	case http.StatusRequestTimeout:
		return "Upstream request timed out"
	case http.StatusTooManyRequests:
		return "Upstream rate limit exceeded"
	case http.StatusBadGateway:
		return "Upstream provider returned a bad gateway"
	case http.StatusServiceUnavailable:
		return "Upstream provider unavailable"
	default:
		return "Upstream provider request failed"
	}
}

func NormalizeRetryAfter(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if seconds, err := strconv.ParseUint(value, 10, 31); err == nil {
		return strconv.FormatUint(seconds, 10)
	}
	if parsed, err := http.ParseTime(value); err == nil && !parsed.IsZero() {
		return parsed.UTC().Format(http.TimeFormat)
	}
	return ""
}
