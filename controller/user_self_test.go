package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func performUpdateSelfRequest(t *testing.T, userID int, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/user/self", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", userID)
	UpdateSelf(c)
	return recorder
}

func TestUpdateSelfRejectsServerControlledFields(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{
		Username: "self-update-owner", DisplayName: "Original", Password: "unused-password",
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default",
		Quota: 12345, AuthVersion: 1, AffCode: "self-update-owner",
	}
	require.NoError(t, db.Create(&user).Error)

	for name, body := range map[string]string{
		"username": `{"username":"renamed-owner","display_name":"Changed"}`,
		"quota":    `{"quota":999999,"display_name":"Changed"}`,
		"status":   `{"status":2}`,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := performUpdateSelfRequest(t, user.Id, body)
			assert.Contains(t, recorder.Body.String(), `"success":false`)

			var unchanged model.User
			require.NoError(t, db.First(&unchanged, user.Id).Error)
			assert.Equal(t, "self-update-owner", unchanged.Username)
			assert.Equal(t, "Original", unchanged.DisplayName)
			assert.Equal(t, 12345, unchanged.Quota)
			assert.Equal(t, common.UserStatusEnabled, unchanged.Status)
		})
	}
}

func TestUpdateSelfAllowsDisplayNameOnly(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{
		Username: "self-display-owner", DisplayName: "Before", Password: "unused-password",
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default",
		AuthVersion: 1, AffCode: "self-display-owner",
	}
	require.NoError(t, db.Create(&user).Error)

	recorder := performUpdateSelfRequest(t, user.Id, `{"display_name":"After"}`)
	assert.Contains(t, recorder.Body.String(), `"success":true`)

	var updated model.User
	require.NoError(t, db.First(&updated, user.Id).Error)
	assert.Equal(t, "self-display-owner", updated.Username)
	assert.Equal(t, "After", updated.DisplayName)
}

func TestUpdateSelfRejectsEmptyDisplayName(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{
		Username: "self-empty-display", DisplayName: "Before", Password: "unused-password",
		Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default",
		AuthVersion: 1, AffCode: "self-empty-display",
	}
	require.NoError(t, db.Create(&user).Error)

	for _, body := range []string{`{"display_name":""}`, `{"display_name":"   "}`} {
		recorder := performUpdateSelfRequest(t, user.Id, body)
		assert.Contains(t, recorder.Body.String(), `"success":false`)
	}

	var unchanged model.User
	require.NoError(t, db.First(&unchanged, user.Id).Error)
	assert.Equal(t, "Before", unchanged.DisplayName)
}
