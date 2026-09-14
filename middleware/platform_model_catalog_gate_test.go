package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestDistributeRejectsCatalogModelWithAPIDisabled(t *testing.T) {
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	previousRedis := common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.PlatformModelCatalog{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled = previousRedis
	})

	entry := model.PlatformModelCatalog{
		PublicModelID:      "platform-disabled-test",
		DisplayName:        "Disabled test model",
		ProviderKey:        "platform",
		ProviderLabel:      "Platform",
		DescriptionEN:      "Disabled test entry.",
		DescriptionZhCN:    "禁用测试目录项。",
		Category:           "general",
		Capabilities:       model.JSONStringList{"chat"},
		InputModalities:    model.JSONStringList{"text"},
		OutputModalities:   model.JSONStringList{"text"},
		IconKey:            "platform",
		AvailabilityStatus: model.PlatformModelAvailabilityDisabled,
		Visibility:         model.PlatformModelVisibilityPublic,
		APIEnabled:         false,
	}
	require.NoError(t, model.CreatePlatformModelCatalog(&entry))

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/v1/chat/completions", Distribute(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/chat/completions",
		strings.NewReader(`{"model":"platform-disabled-test","messages":[]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Contains(t, response.Body.String(), "not enabled for API access")
}
