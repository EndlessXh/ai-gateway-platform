package service

import (
	"sync"
	"testing"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type billingLifecycleFunding struct {
	mu          sync.Mutex
	settleCalls int
	refundCalls int
	refunded    chan struct{}
}

func (f *billingLifecycleFunding) Source() string         { return BillingSourceWallet }
func (f *billingLifecycleFunding) PreConsume(_ int) error { return nil }
func (f *billingLifecycleFunding) Settle(_ int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.settleCalls++
	return nil
}
func (f *billingLifecycleFunding) Refund() error {
	f.mu.Lock()
	f.refundCalls++
	f.mu.Unlock()
	select {
	case f.refunded <- struct{}{}:
	default:
	}
	return nil
}

func TestBillingSessionFailedRelayRefundsExactlyOnce(t *testing.T) {
	funding := &billingLifecycleFunding{refunded: make(chan struct{}, 2)}
	session := &BillingSession{
		relayInfo:        &relaycommon.RelayInfo{IsPlayground: true},
		funding:          funding,
		preConsumedQuota: 10,
		tokenConsumed:    10,
	}
	c, _ := gin.CreateTestContext(nil)

	session.Refund(c)
	session.Refund(c)
	select {
	case <-funding.refunded:
	case <-time.After(time.Second):
		require.FailNow(t, "refund did not complete")
	}
	funding.mu.Lock()
	assert.Equal(t, 1, funding.refundCalls)
	funding.mu.Unlock()
	assert.False(t, session.NeedsRefund())
}

func TestBillingSessionRetryCannotSettleTwice(t *testing.T) {
	funding := &billingLifecycleFunding{refunded: make(chan struct{}, 1)}
	session := &BillingSession{
		relayInfo:        &relaycommon.RelayInfo{IsPlayground: true},
		funding:          funding,
		preConsumedQuota: 5,
	}

	require.NoError(t, session.Settle(7))
	require.NoError(t, session.Settle(7))
	funding.mu.Lock()
	assert.Equal(t, 1, funding.settleCalls)
	funding.mu.Unlock()
	assert.False(t, session.NeedsRefund())
}

func TestBillingSessionRefundWinningRacePreventsSettlement(t *testing.T) {
	funding := &billingLifecycleFunding{refunded: make(chan struct{}, 1)}
	session := &BillingSession{
		relayInfo:        &relaycommon.RelayInfo{IsPlayground: true},
		funding:          funding,
		preConsumedQuota: 5,
		tokenConsumed:    5,
	}
	c, _ := gin.CreateTestContext(nil)

	// Refund marks the terminal state before scheduling the asynchronous
	// funding operation. A concurrent upstream completion must not settle the
	// same reservation after that point.
	session.Refund(c)
	require.NoError(t, session.Settle(7))
	select {
	case <-funding.refunded:
	case <-time.After(time.Second):
		require.FailNow(t, "refund did not complete")
	}

	funding.mu.Lock()
	assert.Zero(t, funding.settleCalls)
	assert.Equal(t, 1, funding.refundCalls)
	funding.mu.Unlock()
}

func TestBillingSessionConcurrentRefundAndSettleChooseOneTerminalState(t *testing.T) {
	for i := 0; i < 64; i++ {
		funding := &billingLifecycleFunding{refunded: make(chan struct{}, 1)}
		session := &BillingSession{
			relayInfo:        &relaycommon.RelayInfo{IsPlayground: true},
			funding:          funding,
			preConsumedQuota: 5,
			tokenConsumed:    5,
		}
		c, _ := gin.CreateTestContext(nil)
		start := make(chan struct{})
		settleErr := make(chan error, 1)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			session.Refund(c)
		}()
		go func() {
			defer wg.Done()
			<-start
			settleErr <- session.Settle(7)
		}()
		close(start)
		wg.Wait()
		require.NoError(t, <-settleErr)

		session.mu.Lock()
		settled, refunded := session.settled, session.refunded
		session.mu.Unlock()
		require.NotEqual(t, settled, refunded, "exactly one terminal state must win")
		if refunded {
			select {
			case <-funding.refunded:
			case <-time.After(time.Second):
				require.FailNow(t, "refund did not complete")
			}
		}
		funding.mu.Lock()
		require.Equal(t, 1, funding.settleCalls+funding.refundCalls)
		funding.mu.Unlock()
	}
}
