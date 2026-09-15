package model

import (
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitDBWithoutMigrationDoesNotCreateSchema(t *testing.T) {
	previousDB := DB
	previousPath := common.SQLitePath
	previousType := common.MainDatabaseType()
	previousMaster := common.IsMasterNode

	common.SQLitePath = filepath.Join(t.TempDir(), "readonly.db")
	common.IsMasterNode = true
	t.Setenv("SQL_DSN", "local")
	t.Cleanup(func() {
		if DB != nil && DB != previousDB {
			sqlDB, err := DB.DB()
			if err == nil {
				_ = sqlDB.Close()
			}
		}
		DB = previousDB
		common.SQLitePath = previousPath
		common.SetMainDatabaseType(previousType)
		common.IsMasterNode = previousMaster
	})

	require.NoError(t, InitDBWithoutMigration())

	var userTableCount int64
	require.NoError(t, DB.Raw("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?", "users").Scan(&userTableCount).Error)
	assert.Zero(t, userTableCount)
}
