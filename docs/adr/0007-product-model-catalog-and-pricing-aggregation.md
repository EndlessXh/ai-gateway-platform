# ADR 0007 — Product model catalog and pricing aggregation

**Status:** Accepted
**Date:** 2026-07-29

## Context

The upstream `models` table participates in official-model synchronization,
vendor metadata and deployment management. Extending it with product-facing
copy and switches would couple this product to upstream sync behavior. Channels
already own credentials, provider URLs, priority, weight, failover and
`model_mapping`; the ratio settings already own every billable price. Neither
responsibility belongs in product metadata.

## Decision

Add the independent, soft-deletable `platform_model_catalog` table. Its stable
`public_model_id` is the join key to existing channel abilities and pricing
settings. It never stores a channel ID, upstream name, URL, key or price.

Capabilities and modalities are JSON arrays stored through
`common.Marshal`/`common.Unmarshal` in a portable `TEXT` column. This avoids
lossy comma encoding and PostgreSQL-only JSONB. Availability, visibility,
capability, modality, icon and badge values are application-level allowlisted
enums. Validation runs on create, update and seed for consistent SQLite, MySQL
and PostgreSQL behavior; the unique database index remains the final
concurrency guard for `public_model_id`.

Public reads aggregate three independent truths:

1. product presentation from `platform_model_catalog`;
2. route existence/accessibility from existing `abilities` and enabled
   `channels`, filtered by the user's usable groups;
3. prices from `ratio_setting` through the existing `model.GetPricing()` path.

The existing `/api/pricing` response is enriched with matching catalog
metadata after its established group filtering. Its price fields and billing
algorithm are unchanged. Relay distribution rejects a cataloged model when
`api_enabled=false`; models not represented in the catalog retain upstream
compatibility.

Catalog reads use the existing hybrid cache under
`platform:model_catalog:v1:active-list`, TTL 30 seconds. Admin writes actively
delete that shared Redis key and the local hot entry. Redis failure degrades to
the database plus the bounded process-local cache; price aggregation is not
stored in this catalog cache.

## Consequences

- One public alias can continue to fail over across multiple channels.
- Changing channel mappings does not change the customer-facing ID or require
  a catalog edit.
- Visibility and API enablement are independent controls.
- Admin diagnostics can report no route, inaccessible group, missing price,
  hidden-but-callable and visible-but-disabled states without exposing secrets.
- Array queries are intentionally performed in application code; the catalog
  is small and read-cached, while portability is preserved.
- Soft archive keeps historical relay/log references meaningful.

## Rejected alternatives

- Extending upstream `models`: conflicts with sync/vendor/deployment semantics.
- A second routing table: duplicates channel selection and failover.
- Channel foreign keys in the catalog: prevents multi-channel aliases.
- Price columns in the catalog: creates a second billing truth.
- Comma-separated arrays or arbitrary JSON: lossy or insufficiently validated.
