// Command release-openrouter-batch applies a reviewed, explicit batch release
// (visibility, and optionally api_enabled) to a fixed list of OpenRouter-
// synced catalog rows. Input is a JSON file (see ReleaseCandidate) so the
// exact set being released is a reviewable artifact, not a CLI flag. Same
// minimal bootstrap as cmd/sync-openrouter-catalog: no HTTP server, no
// background tasks.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

type candidateInput struct {
	PublicModelID string `json:"public_model_id"`
	EnableAPI     bool   `json:"enable_api"`
}

func main() {
	inputPath := flag.String("input", "", "path to a JSON array of {public_model_id, enable_api}")
	flag.Parse()

	if *inputPath == "" {
		fmt.Fprintln(os.Stderr, "usage: release-openrouter-batch -input <candidates.json>")
		os.Exit(2)
	}

	raw, err := os.ReadFile(*inputPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read input:", err)
		os.Exit(1)
	}
	var inputs []candidateInput
	if err := json.Unmarshal(raw, &inputs); err != nil {
		fmt.Fprintln(os.Stderr, "parse input:", err)
		os.Exit(1)
	}
	candidates := make([]service.ReleaseCandidate, 0, len(inputs))
	for _, in := range inputs {
		candidates = append(candidates, service.ReleaseCandidate{PublicModelID: in.PublicModelID, EnableAPI: in.EnableAPI})
	}

	common.InitEnv()
	if err := model.InitDB(); err != nil {
		fmt.Fprintln(os.Stderr, "init db:", err)
		os.Exit(1)
	}
	model.InitOptionMap()

	result, err := service.ReleasePlatformModels(candidates)
	if err != nil {
		fmt.Fprintln(os.Stderr, "release failed:", err)
		os.Exit(1)
	}

	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "encode result:", err)
		os.Exit(1)
	}
	fmt.Println(string(encoded))
}
