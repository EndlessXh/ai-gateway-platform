package controller_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPlatformModelAdminAPIRejectsAnonymousRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/platform/admin/models", middleware.AdminAuth(), controller.AdminListPlatformModels)
	request := httptest.NewRequest(http.MethodGet, "/api/platform/admin/models", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusUnauthorized, response.Code)
}

func TestPlatformModelAdminAPIRejectsCommonUser(t *testing.T) {
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	previousRedis := common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled = previousRedis
	})

	accessToken := "phase5a-common-user-pat"
	user := &model.User{
		Username:    "phase5a-common-user",
		Password:    "password-placeholder",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AccessToken: &accessToken,
		AuthVersion: 1,
		AffCode:     "phase5a-common-user-aff",
	}
	require.NoError(t, db.Create(user).Error)

	router := gin.New()
	router.GET("/api/platform/admin/models", middleware.AdminAuth(), controller.AdminListPlatformModels)
	request := httptest.NewRequest(http.MethodGet, "/api/platform/admin/models", nil)
	request.Header.Set("Authorization", "Bearer "+accessToken)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Contains(t, response.Body.String(), "AUTH_INSUFFICIENT_PRIVILEGE")
}
