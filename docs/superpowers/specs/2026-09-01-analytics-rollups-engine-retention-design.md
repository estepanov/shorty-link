---
title: Analytics Rollups, Engine Sink, and Retention
---

# Analytics Rollups, Engine Sink, and Retention

## Problem

Roadmap stages 4–6 are unimplemented:

4. Rollup tables, an aggregator Cron Trigger, and dashboard reads from rollups.
5. An Analytics Engine implementation of `recordClick`.
6. A documented raw-event retention policy once rollups are authoritative.

## Constraints

- One Worker. No extra deployables.
- Default deploys keep working with no cron, no Analytics Engine, and no retention var.
- Redirect path stays `waitUntil(recordClick(...))`.
- Analytics Engine’s Worker binding is write-only. Admin UI cannot query AE without an account SQL API token, so D1 stays the admin source of truth.

## Design

### Stage 4 — Rollups

Tables:

- `redirect_event_daily (link_id, day, total)` — UTC midnight ms, PK `(link_id, day)`
- `redirect_event_dimension_daily (link_id, day, dimension, value, total)` — PK `(link_id, day, dimension, value)`
- `analytics_aggregation_state (id, last_success_at, locked_until)` — single row `default`. `locked_until` is a lease so overlapping cron runs cannot double-add rollups. Not a stats read input.
- `redirect_event.aggregated` — boolean, default false

Dimensions match the dashboard and live in one catalog (`DIMENSIONS`): `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`, `browser`, `os`, `deviceType`. UTM nulls are omitted. UA nulls become `Unknown`. No hourly or referrer rollups; those are not dashboard query patterns. Recent events stay a raw-event detail query.

`aggregateAnalytics(db, { now, retainDays? })`:

1. Load raw events with `aggregated = 0`, oldest first, in chunks.
2. Take a row lease on `analytics_aggregation_state` (`locked_until`). If another run holds the lease, return.
3. Fold daily and dimension totals from the catalog.
4. Multi-row upsert rollups (`total = total + excluded.total`), mark those rows `aggregated = 1`, and recount `short_link` hit metadata for touched link IDs.
5. Release the lease (`locked_until = 0`, `last_success_at = now`).
6. If `retainDays` is a positive integer, delete raw events with `aggregated = 1` and `created_at < now - retainDays * 86400000`.

The Worker `scheduled` handler runs this. Cron is commented in `wrangler.jsonc` (same opt-in style as queues). Tests call `aggregateAnalytics` directly.

`getLinkStats` lives in `src/server/services/analytics/stats.ts`. All-time totals use the same SQL as `persistClicks` (`sum(daily.total) + count(unaggregated)`). Window, histogram, and breakdowns are rollups plus `aggregated = 0` events. Recent events always read raw rows.

### Stage 5 — Analytics Engine

Optional binding `ANALYTICS`. Duck-type: has `writeDataPoint`. When present, `recordClick` writes one data point (sync, not awaited) **and** still enqueues or persists to D1. AE is an extra emit sink for the Cloudflare SQL/GraphQL APIs, not a replacement for admin D1.

`recordClick(db, input, sinks?)` takes `{ queue?, engine? }` and defaults both from `env`.

### Stage 6 — Retention

`ANALYTICS_RAW_EVENT_RETENTION_DAYS` is optional. Unset or non-positive: keep raw events. Positive integer: aggregator deletes rolled-up events older than that many days. Document the policy: dashboards use rollups plus the unaggregated tail; raw events are a bounded detail log.

## Non-goals

- Pulling AE SQL into D1 (needs an account API token).
- Hourly rollups.
- Changing the admin UI layout.
