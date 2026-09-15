package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestProcessChannelErrorKeepsOpenRouterDetailsAdminOnly(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousErrorLogEnabled := constant.ErrorLogEnabled
	previousRedisEnabled := common.RedisEnabled
	previousMainDBType, previousLogDBType := common.MainDatabaseType(), common.LogDatabaseType()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		constant.ErrorLogEnabled = previousErrorLogEnabled
		common.RedisEnabled = previousRedisEnabled
		common.SetDatabaseTypes(previousMainDBType, previousLogDBType)
	})

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.User{}))
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	constant.ErrorLogEnabled = true
	common.RedisEnabled = false

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	c.Set("id", 42)
	c.Set("channel_id", 17)
	c.Set("channel_name", "openrouter-private")
	c.Set("channel_type", constant.ChannelTypeOpenRouter)
	c.Set("original_model", "claude-opus-4.6")
	c.Set("token_name", "test-token")
	c.Set("token_id", 3)
	c.Set("group", "default")

	apiErr := types.NewErrorWithStatusCode(
		errors.New("private provider detail anthropic/claude-opus-4.6"),
		types.ErrorCodeBadResponseStatusCode,
		http.StatusBadGateway,
	)
	processChannelError(c, types.ChannelError{ChannelId: 17}, apiErr)

	var stored model.Log
	require.NoError(t, db.Order("id desc").First(&stored).Error)
	require.Equal(t, "status_code=502, Upstream provider returned a bad gateway", stored.Content)
	other, err := common.StrToMap(stored.Other)
	require.NoError(t, err)
	require.NotContains(t, other, "channel_id")
	require.NotContains(t, other, "channel_name")
	require.NotContains(t, other, "channel_type")
	adminInfo, ok := other["admin_info"].(map[string]interface{})
	require.True(t, ok)
	require.Contains(t, adminInfo["upstream_error"], "private provider detail")
}
