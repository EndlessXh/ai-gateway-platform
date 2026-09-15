package platform

import "testing"

func TestResolveProductName(t *testing.T) {
	t.Setenv("PLATFORM_BRAND_NAME", "Deployment Brand")

	tests := []struct {
		name  string
		admin string
		want  string
	}{
		{name: "admin override", admin: "Admin Brand", want: "Admin Brand"},
		{name: "upstream default", admin: "New API", want: "Deployment Brand"},
		{name: "empty", admin: "", want: "Deployment Brand"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ResolveProductName(test.admin); got != test.want {
				t.Fatalf("ResolveProductName(%q) = %q, want %q", test.admin, got, test.want)
			}
		})
	}
}

func TestResolveProductNameUsesSafeFallback(t *testing.T) {
	t.Setenv("PLATFORM_BRAND_NAME", "")
	if got := ResolveProductName("NewAPI"); got != DefaultProductName {
		t.Fatalf("ResolveProductName(NewAPI) = %q, want %q", got, DefaultProductName)
	}
}
