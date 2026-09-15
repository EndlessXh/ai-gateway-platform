// Command rollback-openrouter-catalog-batch lists or rolls back catalog rows
// created by one OpenRouter sync batch. It defaults to dry-run; use -apply
// only after reviewing the emitted model list.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

func main() {
	batchID := flag.String("batch", "", "SyncBatchID to enumerate or roll back")
	apply := flag.Bool("apply", false, "soft-delete the listed sync-created rows")
	flag.Parse()
	if *batchID == "" {
		fmt.Fprintln(os.Stderr, "usage: rollback-openrouter-catalog-batch -batch <id> [-apply]")
		os.Exit(2)
	}

	common.InitEnv()
	initDB := model.InitDB
	if !*apply {
		// Listing a batch is a read-only production safety check. It must not
		// run schema migrations merely to enumerate potential rollback targets.
		initDB = model.InitDBWithoutMigration
	}
	if err := initDB(); err != nil {
		fmt.Fprintln(os.Stderr, "init db:", err)
		os.Exit(1)
	}

	result, err := service.RollbackOpenRouterCatalogBatch(*batchID, *apply)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rollback failed:", err)
		os.Exit(1)
	}
	encoded, err := common.Marshal(result)
	if err != nil {
		fmt.Fprintln(os.Stderr, "encode result:", err)
		os.Exit(1)
	}
	fmt.Println(string(encoded))
}
