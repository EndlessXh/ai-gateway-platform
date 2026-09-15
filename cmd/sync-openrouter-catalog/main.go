// Command sync-openrouter-catalog runs one OpenRouter catalog sync against a
// real database, for manual dev verification before the admin-triggered
// endpoint exists. It initializes only what service.SyncOpenRouterCatalog
// needs (env, database, option map) — it does not start the HTTP server or
// any background task runner, and is safe to run alongside an already
// running instance since it opens its own connection pool.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

func main() {
	channelID := flag.Int("channel", 0, "OpenRouter channel id to fetch /v1/models through")
	batchID := flag.String("batch", "", "sync batch id (default: current UTC timestamp)")
	dryRun := flag.Bool("dry-run", false, "calculate the full sync plan without writing any table")
	flag.Parse()

	if *channelID <= 0 {
		fmt.Fprintln(os.Stderr, "usage: sync-openrouter-catalog -channel <id> [-batch <id>] [-dry-run]")
		os.Exit(2)
	}

	common.InitEnv()
	initDB := model.InitDB
	if *dryRun {
		// A dry-run must not invoke AutoMigrate: production inspection is
		// read-only, including schema initialization.
		initDB = model.InitDBWithoutMigration
	}
	if err := initDB(); err != nil {
		fmt.Fprintln(os.Stderr, "init db:", err)
		os.Exit(1)
	}
	// No defer model.CloseDB(): it unconditionally also closes LOG_DB, which
	// this tool never initializes (the sync doesn't touch the log database),
	// so LOG_DB is nil and CloseDB panics. A short-lived CLI process doesn't
	// need an explicit close; process exit reclaims the connection.
	model.InitOptionMap()

	result, err := service.SyncOpenRouterCatalog(context.Background(), service.OpenRouterSyncOptions{
		ChannelID: *channelID,
		BatchID:   *batchID,
		DryRun:    *dryRun,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "sync failed:", err)
		os.Exit(1)
	}

	encoded, err := common.Marshal(result)
	if err != nil {
		fmt.Fprintln(os.Stderr, "encode result:", err)
		os.Exit(1)
	}
	fmt.Println(string(encoded))
}
