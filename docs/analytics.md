---
title: Analytics
---

# Analytics

Clicks are recorded on every successful redirect. The default path needs no extra Cloudflare products. Queue buffering, daily rollups, raw-event retention, and Analytics Engine export are **opt-in** and independent except where this page says otherwise.

Do not uncomment those bindings unless you want that piece. A default self-host stays one Worker, one D1 database, and a direct `waitUntil` write.

## What you get by default

On each redirect the Worker calls `recordClick` inside `waitUntil`:

1. Persist a `redirect_event` row in D1.
2. Recount that link’s `hit_count` from daily rollups plus events that are not yet aggregated.

The admin dashboard, link list, and link-detail stats all use that same all-time formula. Recent clicks still read raw rows (a detail log).

No queue, no cron, and no Analytics Engine are required.

## Choose an opt-in path

| Goal | Enable |
| --- | --- |
| Small or medium traffic, simplest deploy | Nothing extra |
| Buffer D1 writes under bursty click traffic | [Queue](#queue) |
| Keep dashboard totals cheap after many clicks | [Daily rollups](#daily-rollups) |
| Cap raw event storage after rollups exist | [Rollups + retention](#retention) |
| Query clicks from Cloudflare SQL/GraphQL | [Analytics Engine](#analytics-engine) |

You can enable queue, rollups, and Analytics Engine in any combination. Retention only deletes rows the aggregator has already folded, so turn on the cron first.

After you change bindings, regenerate types and redeploy:

```bash
pnpm cf-typegen
pnpm deploy
```

`wrangler.jsonc` keeps the optional blocks commented. Add a comma after the `ai` object when you uncomment the first one.

## Queue

Use this when per-click D1 inserts become a cost or contention problem. The redirect still returns immediately. The same Worker consumes the queue and writes the same `redirect_event` rows the direct path writes.

1. Create the queue and dead-letter queue:

   ```bash
   pnpm exec wrangler queues create shorty-link-analytics
   pnpm exec wrangler queues create shorty-link-analytics-dlq
   ```

2. Uncomment the `queues` block in `wrangler.jsonc`. Keep the binding name `ANALYTICS_QUEUE`. Queue names are yours.

3. Deploy. Invalid messages are `retry()`’d so Cloudflare can dead-letter them after `max_retries`. Clicks for a deleted link are skipped so one missing `linkId` cannot fail the rest of a batch.

Leave this commented to keep the direct D1 write.

See [Cloudflare Queues](https://developers.cloudflare.com/queues/) and the [Configuration](/configuration/#analytics_queue) snippet.

## Daily rollups

Use this when `redirect_event` is large enough that dashboard scans hurt. The Worker `scheduled` handler folds unaggregated rows into `redirect_event_daily` and `redirect_event_dimension_daily`, then marks those rows aggregated.

1. Apply migrations if you have not already (`0010_analytics_rollups.sql` creates the empty tables):

   ```bash
   pnpm db:migrate:remote
   ```

2. Uncomment the `triggers.crons` block in `wrangler.jsonc`. The sample schedule is every five minutes (`*/5 * * * *`). Change it if you want.

3. Deploy. The first successful run writes rollups. New clicks stay visible immediately because stats add the unaggregated tail.

Overlapping cron runs take a D1 row lease so additive upserts cannot double-count.

See [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and the [Configuration](/configuration/#analytics-aggregator-cron) snippet.

## Retention

Use this only after rollups are running. Set `ANALYTICS_RAW_EVENT_RETENTION_DAYS` to a positive integer (string or number). The aggregator then deletes **aggregated** raw rows older than that many days.

Unset, `0`, or a negative value keeps raw events forever. Unaggregated events are never deleted.

Add the var to `wrangler.jsonc` `vars` (or a Worker var in the dashboard):

```jsonc
"ANALYTICS_RAW_EVENT_RETENTION_DAYS": "90"
```

Recent-click tables shrink to whatever raw rows remain. All-time totals on the dashboard and link detail stay correct because they read rollups plus the unaggregated tail.

## Analytics Engine

Use this when you want Cloudflare’s SQL/GraphQL APIs in addition to the admin UI. The Worker writes one data point **after** the durable D1 or queue write. The admin UI does not query Analytics Engine.

1. Create a Workers Analytics Engine dataset in the Cloudflare dashboard.
2. Uncomment `analytics_engine_datasets` in `wrangler.jsonc`. Keep the binding name `ANALYTICS`. The dataset name is yours.

This copies click metadata (referer, user agent, city, country, UTMs, target URL — not `ipHash`) into an **account-level** dataset. Anyone with Analytics Engine SQL/GraphQL access on that account can query every link’s clicks. That path does not use Better Auth, link/domain scope, or `analytics.read`. Treat it as an explicit export, not a drop-in observability toggle.

See [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) and the [Configuration](/configuration/#analytics) snippet.

## What stays out of this Worker

These are not part of the opt-in path:

- A second consumer Worker. The queue consumer lives on this same deployable.
- Hourly or referrer rollups. The dashboard does not query those shapes.
- Reading Analytics Engine from the admin UI. D1 remains the source of truth.

The multi-service split is a later [roadmap](/roadmap/multi-service-architecture/) item, not a requirement to use analytics.
