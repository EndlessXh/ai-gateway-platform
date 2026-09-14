package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const privateModel = "private-stub-model"

type stubState struct {
	requests    atomic.Int64
	cancelled   atomic.Int64
	interrupted atomic.Int64
	messages    atomic.Int64
	shapeMu     sync.RWMutex
	lastShape   map[string]any
}

type chatRequest struct {
	Stream   bool             `json:"stream"`
	Messages []map[string]any `json:"messages"`
	Tools    []map[string]any `json:"tools"`
}

func main() {
	listen := flag.String("listen", "127.0.0.1:3102", "loopback listen address")
	flag.Parse()

	if !strings.HasPrefix(*listen, "127.0.0.1:") && !strings.HasPrefix(*listen, "[::1]:") {
		panic("relay stub only permits loopback listeners")
	}
	server := &http.Server{
		Addr:              *listen,
		Handler:           newStubHandler(&stubState{}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		panic(err)
	}
	fmt.Printf("relay-stub listening on %s\n", listener.Addr())
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}

func newStubHandler(state *stubState) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.HandleFunc("GET /__stub/state", func(w http.ResponseWriter, _ *http.Request) {
		state.shapeMu.RLock()
		lastShape := state.lastShape
		state.shapeMu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"requests":           state.requests.Load(),
			"cancelled":          state.cancelled.Load(),
			"interrupted":        state.interrupted.Load(),
			"messages":           state.messages.Load(),
			"last_message_shape": lastShape,
		})
	})
	mux.HandleFunc("POST /v1/messages", func(w http.ResponseWriter, r *http.Request) {
		state.requests.Add(1)
		state.messages.Add(1)
		var request map[string]any
		if err := common.DecodeJson(r.Body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid stub Messages request")
			return
		}
		state.shapeMu.Lock()
		state.lastShape = safeMessageRequestShape(r.Header, request)
		state.shapeMu.Unlock()
		model, _ := request["model"].(string)
		stream, _ := request["stream"].(bool)
		if stream {
			writeMessagesStream(w, model)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id": "msg_private_stub", "type": "message", "role": "assistant", "model": model,
			"content":     []any{map[string]any{"type": "text", "text": "LOCAL_CLAUDE_STUB_OK"}},
			"stop_reason": "end_turn", "stop_sequence": nil,
			"usage": map[string]any{"input_tokens": 8, "output_tokens": 3},
		})
	})
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		state.requests.Add(1)
		var rawRequest map[string]any
		if err := common.DecodeJson(r.Body, &rawRequest); err != nil {
			writeError(w, http.StatusBadRequest, "invalid stub request")
			return
		}
		request, err := common.Any2Type[chatRequest](rawRequest)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid stub request")
			return
		}
		state.shapeMu.Lock()
		state.lastShape = safeChatRequestShape(r.Header, rawRequest)
		state.shapeMu.Unlock()
		text := requestText(request.Messages)
		switch {
		case strings.Contains(text, "STUB_401"):
			writeError(w, http.StatusUnauthorized, "private stub authentication detail")
		case strings.Contains(text, "STUB_429"):
			w.Header().Set("Retry-After", "7")
			writeError(w, http.StatusTooManyRequests, "private stub rate-limit detail")
		case strings.Contains(text, "STUB_500"):
			writeError(w, http.StatusInternalServerError, "private stub internal detail")
		case strings.Contains(text, "STUB_TIMEOUT"):
			select {
			case <-r.Context().Done():
				state.cancelled.Add(1)
			case <-time.After(5 * time.Second):
				writeChat(w, "TOO_LATE", false)
			}
		case strings.Contains(text, "STUB_INTERRUPT"):
			state.interrupted.Add(1)
			writeInterruptedStream(w)
		case request.Stream:
			writeChatStream(w, responseText(text), len(request.Tools) > 0 && !hasToolResult(request.Messages))
		default:
			writeChat(w, responseText(text), len(request.Tools) > 0 && !hasToolResult(request.Messages))
		}
	})
	return mux
}

func safeChatRequestShape(header http.Header, request map[string]any) map[string]any {
	shape := safeMessageRequestShape(header, request)
	shape["format"] = "openai_chat"
	shape["model"] = ""
	shape["upstream_model_present"] = stringValue(request["model"]) != ""
	shape["system_messages"] = messageRoleCount(request["messages"], "system")
	shape["tool_messages"] = messageRoleCount(request["messages"], "tool")
	shape["reasoning_present"] = request["reasoning"] != nil
	shape["reasoning_enabled"] = nestedBoolValue(request["reasoning"], "enabled")
	shape["reasoning_budget_present"] = nestedNumberValue(request["reasoning"], "max_tokens") != nil
	shape["provider_present"] = request["provider"] != nil
	shape["provider_data_collection"] = nestedStringValue(request["provider"], "data_collection")
	shape["provider_zdr"] = nestedBoolValue(request["provider"], "zdr")
	shape["provider_require_parameters"] = nestedBoolValue(request["provider"], "require_parameters")
	return shape
}

func safeMessageRequestShape(header http.Header, request map[string]any) map[string]any {
	headerNames := make([]string, 0, len(header))
	for name := range header {
		headerNames = append(headerNames, http.CanonicalHeaderKey(name))
	}
	sort.Strings(headerNames)

	fields := make([]string, 0, len(request))
	fieldTypes := make(map[string]string, len(request))
	for name, value := range request {
		fields = append(fields, name)
		fieldTypes[name] = jsonShapeType(value)
	}
	sort.Strings(fields)

	shape := map[string]any{
		"header_names":             headerNames,
		"top_level_fields":         fields,
		"field_types":              fieldTypes,
		"model":                    stringValue(request["model"]),
		"stream":                   boolValue(request["stream"]),
		"max_tokens":               numberValue(request["max_tokens"]),
		"messages_count":           arrayLength(request["messages"]),
		"system_blocks":            blockCount(request["system"]),
		"tools_count":              arrayLength(request["tools"]),
		"stop_sequences_count":     arrayLength(request["stop_sequences"]),
		"content_block_types":      contentBlockTypes(request["messages"]),
		"thinking_type":            nestedStringValue(request["thinking"], "type"),
		"thinking_budget_present":  nestedNumberValue(request["thinking"], "budget_tokens") != nil,
		"thinking_budget_near_max": thinkingBudgetNearMax(request),
		"tool_choice_type":         nestedStringValue(request["tool_choice"], "type"),
		"metadata_present":         request["metadata"] != nil,
		"cache_control_present":    containsObjectKey(request, "cache_control"),
	}
	return shape
}

func nestedNumberValue(value any, key string) any {
	object, _ := value.(map[string]any)
	return numberValue(object[key])
}

func nestedBoolValue(value any, key string) bool {
	object, _ := value.(map[string]any)
	return boolValue(object[key])
}

func messageRoleCount(value any, wanted string) int {
	messages, _ := value.([]any)
	count := 0
	for _, messageValue := range messages {
		message, _ := messageValue.(map[string]any)
		if stringValue(message["role"]) == wanted {
			count++
		}
	}
	return count
}

func thinkingBudgetNearMax(request map[string]any) bool {
	budget, budgetOK := nestedNumberValue(request["thinking"], "budget_tokens").(float64)
	maximum, maximumOK := numberValue(request["max_tokens"]).(float64)
	return budgetOK && maximumOK && maximum > 0 && budget >= maximum-1
}

func jsonShapeType(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case float64, float32, int, int64, uint, uint64:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return "unknown"
	}
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func numberValue(value any) any {
	if value == nil {
		return nil
	}
	if jsonShapeType(value) == "number" {
		return value
	}
	return nil
}

func arrayLength(value any) int {
	items, _ := value.([]any)
	return len(items)
}

func blockCount(value any) int {
	if value == nil {
		return 0
	}
	if items, ok := value.([]any); ok {
		return len(items)
	}
	return 1
}

func nestedStringValue(value any, key string) string {
	object, _ := value.(map[string]any)
	return stringValue(object[key])
}

func containsObjectKey(value any, wanted string) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == wanted || containsObjectKey(child, wanted) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if containsObjectKey(child, wanted) {
				return true
			}
		}
	}
	return false
}

func contentBlockTypes(value any) []string {
	messages, _ := value.([]any)
	typeSet := map[string]struct{}{}
	for _, messageValue := range messages {
		message, _ := messageValue.(map[string]any)
		blocks, _ := message["content"].([]any)
		for _, blockValue := range blocks {
			block, _ := blockValue.(map[string]any)
			if blockType := stringValue(block["type"]); blockType != "" {
				typeSet[blockType] = struct{}{}
			}
		}
	}
	types := make([]string, 0, len(typeSet))
	for blockType := range typeSet {
		types = append(types, blockType)
	}
	sort.Strings(types)
	return types
}

func writeMessagesStream(w http.ResponseWriter, model string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unavailable")
		return
	}
	events := []struct {
		name string
		data any
	}{
		{name: "message_start", data: map[string]any{"type": "message_start", "message": map[string]any{
			"id": "msg_private_stub", "type": "message", "role": "assistant", "model": model,
			"content": []any{}, "stop_reason": nil, "stop_sequence": nil,
			"usage": map[string]any{"input_tokens": 8, "output_tokens": 0},
		}}},
		{name: "content_block_start", data: map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "text", "text": ""}}},
		{name: "content_block_delta", data: map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": "LOCAL_CLAUDE_STUB_OK"}}},
		{name: "content_block_stop", data: map[string]any{"type": "content_block_stop", "index": 0}},
		{name: "message_delta", data: map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "end_turn", "stop_sequence": nil}, "usage": map[string]any{"output_tokens": 3}}},
		{name: "message_stop", data: map[string]any{"type": "message_stop"}},
	}
	for _, event := range events {
		encoded, err := common.Marshal(event.data)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.name, encoded)
		flusher.Flush()
	}
}

func requestText(messages []map[string]any) string {
	encoded, err := common.Marshal(messages)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func hasToolResult(messages []map[string]any) bool {
	for _, message := range messages {
		if role, _ := message["role"].(string); role == "tool" {
			return true
		}
	}
	return false
}

func responseText(request string) string {
	if strings.Contains(request, "CLAUDE_CODE_HYC_OK") {
		return "CLAUDE_CODE_HYC_OK"
	}
	if strings.Contains(request, "sunny") {
		return "TOOL_RESULT_OK"
	}
	return "LOCAL_SMOKE_OK"
}

func writeChat(w http.ResponseWriter, content string, toolCall bool) {
	message := map[string]any{"role": "assistant", "content": content}
	finishReason := "stop"
	if toolCall {
		message["content"] = nil
		message["tool_calls"] = []any{map[string]any{
			"id":       "call_stub_weather",
			"type":     "function",
			"function": map[string]any{"name": "get_weather", "arguments": `{"city":"Paris"}`},
		}}
		finishReason = "tool_calls"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":      "chatcmpl-private-stub",
		"object":  "chat.completion",
		"created": 1_700_000_000,
		"model":   privateModel,
		"choices": []any{map[string]any{
			"index": 0, "message": message, "finish_reason": finishReason,
		}},
		"usage": map[string]any{"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
	})
}

func writeChatStream(w http.ResponseWriter, content string, toolCall bool) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-OpenRouter-Request-ID", "private-stub-request")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unavailable")
		return
	}
	chunks := []map[string]any{
		streamChunk(map[string]any{"role": "assistant"}, nil),
	}
	if toolCall {
		chunks = append(chunks, streamChunk(map[string]any{"tool_calls": []any{map[string]any{
			"index": 0, "id": "call_stub_weather", "type": "function",
			"function": map[string]any{"name": "get_weather", "arguments": `{"city":"Paris"}`},
		}}}, nil))
		finish := "tool_calls"
		chunks = append(chunks, streamChunk(map[string]any{}, &finish))
	} else {
		chunks = append(chunks, streamChunk(map[string]any{"content": content}, nil))
		finish := "stop"
		chunks = append(chunks, streamChunk(map[string]any{}, &finish))
	}
	for _, chunk := range chunks {
		writeSSE(w, chunk)
		flusher.Flush()
	}
	writeSSE(w, map[string]any{
		"id": "chatcmpl-private-stub", "object": "chat.completion.chunk", "created": 1_700_000_000,
		"model": privateModel, "choices": []any{},
		"usage": map[string]any{"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
	})
	fmt.Fprint(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func streamChunk(delta map[string]any, finishReason *string) map[string]any {
	return map[string]any{
		"id": "chatcmpl-private-stub", "object": "chat.completion.chunk", "created": 1_700_000_000,
		"model":   privateModel,
		"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finishReason}},
	}
}

func writeInterruptedStream(w http.ResponseWriter) {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		writeError(w, http.StatusInternalServerError, "hijacking unavailable")
		return
	}
	conn, buffer, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer conn.Close()
	chunk := streamChunk(map[string]any{"content": "PARTIAL"}, nil)
	encoded, _ := common.Marshal(chunk)
	fmt.Fprintf(buffer, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 4096\r\nConnection: close\r\n\r\ndata: %s\n\n", encoded)
	_ = buffer.Flush()
}

func writeSSE(w http.ResponseWriter, value any) {
	encoded, err := common.Marshal(value)
	if err == nil {
		fmt.Fprintf(w, "data: %s\n\n", encoded)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{"message": message, "type": "stub_error", "code": status},
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	encoded, err := common.Marshal(value)
	if err != nil {
		http.Error(w, "stub encode failure", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}
