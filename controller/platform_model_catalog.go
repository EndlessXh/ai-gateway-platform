package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func platformCatalogLocale(c *gin.Context) string {
	if locale := strings.TrimSpace(c.Query("locale")); locale != "" {
		return locale
	}
	return c.GetHeader("Accept-Language")
}

func platformCatalogUserGroup(c *gin.Context) string {
	userID, ok := c.Get("id")
	if !ok {
		return ""
	}
	user, err := model.GetUserCache(userID.(int))
	if err != nil {
		return ""
	}
	return user.Group
}

func ListPublicPlatformModels(c *gin.Context) {
	entries, err := service.ListPublicPlatformModels(platformCatalogLocale(c), c.Query("surface"), platformCatalogUserGroup(c))
	if err != nil {
		if err.Error() == "invalid catalog surface" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid catalog surface"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "model catalog is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": entries})
}

func GetPublicPlatformModel(c *gin.Context) {
	entry, err := service.GetPublicPlatformModel(c.Param("public_model_id"), platformCatalogLocale(c), platformCatalogUserGroup(c))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "model not found"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "model catalog is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": entry})
}

func AdminListPlatformModels(c *gin.Context) {
	entries, err := service.ListAdminPlatformModels(c.Query("search"), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "model catalog is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": entries})
}

func AdminGetPlatformModel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid model id"})
		return
	}
	entry, err := model.GetPlatformModelCatalogByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "model not found"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "model catalog is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": entry})
}

func AdminCreatePlatformModel(c *gin.Context) {
	var entry model.PlatformModelCatalog
	if err := c.ShouldBindJSON(&entry); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid model catalog payload"})
		return
	}
	entry.ID = 0
	entry.CreatedAt = 0
	entry.UpdatedAt = 0
	if err := service.CreatePlatformModel(&entry); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "message": "", "data": entry})
}

func AdminUpdatePlatformModel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid model id"})
		return
	}
	var entry model.PlatformModelCatalog
	if err := c.ShouldBindJSON(&entry); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid model catalog payload"})
		return
	}
	entry.ID = id
	entry.UpdatedAt = 0
	if err := service.UpdatePlatformModel(&entry); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": entry})
}

type platformModelAPIEnabledPatch struct {
	APIEnabled bool `json:"api_enabled"`
}

func AdminSetPlatformModelAPIEnabled(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid model id"})
		return
	}
	var patch platformModelAPIEnabledPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid model catalog payload"})
		return
	}
	entry, err := model.GetPlatformModelCatalogByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "model not found"})
		return
	}
	entry.APIEnabled = patch.APIEnabled
	if err := service.UpdatePlatformModel(entry); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": entry})
}

func AdminArchivePlatformModel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid model id"})
		return
	}
	if err := service.ArchivePlatformModel(id); err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"success": false, "message": "model could not be archived"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": nil})
}
