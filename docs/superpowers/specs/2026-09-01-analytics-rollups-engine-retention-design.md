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
- `analytics_aggregation_state (id, last_success_at, last_event_created_at)` — single row `default`

Dimensions match the dashboard: `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`, `browser`, `os`, `deviceType`. UTM nulls are omitted. UA nulls become `Unknown`. No hourly or referrer rollups; those are not dashboard query patterns. Recent events stay a raw-event detail query.

`aggregateAnalytics(db, { now, retainDays? })`:

1. Read watermark (`last_event_created_at`, or 0).
2. Load raw events with `created_at > watermark`.
3. Upsert daily and dimension totals (`total = total + excluded.total`).
4. Set watermark to the max `created_at` processed and `last_success_at = now`.
5. If `retainDays` is a positive integer, delete raw events with `created_at <= watermark` and `created_at < now - retainDays * 86400000`.

The Worker `scheduled` handler runs this. Cron is commented in `wrangler.jsonc` (same opt-in style as queues). Tests call `aggregateAnalytics` directly.

`getLinkStats` moves to `src/server/services/analytics/stats.ts`. Totals, histogram, and breakdowns are rollups plus raw events after the watermark. Before the first successful run the watermark is 0, so that is all raw events. Recent events always read raw rows.

### Stage 5 — Analytics Engine

Optional binding `ANALYTICS`. Duck-type: has `writeDataPoint`. When present, `recordClick` writes one data point (sync, not awaited) **and** still enqueues or persists to D1. AE is an extra emit sink for the Cloudflare SQL/GraphQL APIs, not a replacement for admin D1.

`recordClick(db, input, sinks?)` takes `{ queue?, engine? }` and defaults both from `env`.

### Stage 6 — Retention

`ANALYTICS_RAW_EVENT_RETENTION_DAYS` is optional. Unset or non-positive: keep raw events. Positive integer: aggregator deletes rolled-up events older than that many days. Document the policy: dashboards use rollups after the first successful aggregation; raw events are a bounded detail log.

## Non-goals

- Pulling AE SQL into D1 (needs an account API token).
- Hourly rollups.
- Changing the admin UI layout.
