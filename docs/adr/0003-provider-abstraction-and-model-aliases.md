# ADR 0003 — Neutral model aliases and provider isolation

- Status: Accepted
- Date: 2026-07-28

## Context

Development uses an existing Bailian (Alibaba DashScope) channel for real
end-to-end verification. The product intends to add Anthropic, AWS Bedrock,
Google Cloud and others later.

Two hard constraints:

1. **Truth in naming.** Bailian-backed models must never be presented as
   Claude, Anthropic, or any vendor that is not actually serving the request.
   Doing so would be false advertising.
2. **Swappable upstreams.** Changing provider must not change what users
   integrated against.

If users integrate against `qwen-plus`, then the upstream name becomes a public
API contract and moving providers becomes a breaking change for every customer.

## Decision

Publish **platform-owned neutral aliases**; keep the concrete upstream model
private to the channel configuration.

```
platform-general-preview     ->  <general upstream model>
platform-reasoning-preview   ->  <reasoning upstream model>
platform-code-preview        ->  <code upstream model>   (not yet provisioned)
```

Implemented with New API's per-channel `model_mapping`. The channel advertises
only alias names in `models`; `model_mapping` translates alias → upstream model
at relay time. Seeded reproducibly by `scripts/dev-seed-channel.ps1`.

Supporting rules:

- **Aliases are priced as first-class models.** Pricing does not inherit from
  the mapped upstream model, so each alias needs its own `ModelRatio` /
  `CompletionRatio` entry. See ADR 0005.
- **Channel names are neutral** (`upstream-a-dev`), never a vendor claim.
- **Non-admin logs must not disclose the upstream model.** Verified that
  `formatUserLogs` stripped `channel_name` and `admin_info` but left
  `upstream_model_name` in the user-visible `other` payload — a real leak of the
  routing topology. Fixed in `model/log.go`, pinned by
  `TestFormatUserLogsStripsUpstreamModelName`.
- **Admin views keep full routing detail** for debugging. Isolation is about
  what ordinary users can read back, not about hiding information from
  operators.
- **Upstream keys never enter the repository.** The seed script reads the key
  into memory and POSTs it to the admin API; it is never echoed, written to
  disk, or placed on a command line.

## Consequences

**Good.** Provider changes become a channel edit. No customer-visible contract
is tied to a vendor. The naming stays honest, and the day Anthropic is
genuinely connected, a `claude-*`-branded offering can be introduced truthfully.

**Cost.** Aliases are opaque — users cannot tell what they are buying from the
name alone, so the pricing page must describe capability, context window and
performance instead of leaning on a recognisable vendor model name. Every new
alias needs an explicit pricing entry or requests fail with
`model_price_error`. `is_model_mapped: true` remains visible in user logs; it
reveals that mapping occurs but not the target, which is acceptable.

**Rejected — expose upstream model names directly.** Locks the public API to
one vendor and makes migration a breaking change.

**Rejected — vendor-flavoured alias names before the vendor is connected.**
Dishonest, and the brief explicitly forbids it.
