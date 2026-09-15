package channel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestDoRequestPropagatesClientCancellationUpstream(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
		close(cancelled)
	}))
	t.Cleanup(server.Close)
	service.InitHttpClient()

	inboundContext, cancelInbound := context.WithCancel(context.Background())
	inbound := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil).WithContext(inboundContext)
	ginContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	ginContext.Request = inbound
	outbound, err := http.NewRequest(http.MethodPost, server.URL, nil)
	require.NoError(t, err)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI}}

	result := make(chan error, 1)
	go func() {
		_, requestErr := DoRequest(ginContext, outbound, info)
		result <- requestErr
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request did not start")
	}
	cancelInbound()

	select {
	case requestErr := <-result:
		require.Error(t, requestErr)
	case <-time.After(2 * time.Second):
		t.Fatal("Relay request did not stop after client cancellation")
	}
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream server did not observe cancellation")
	}
}
