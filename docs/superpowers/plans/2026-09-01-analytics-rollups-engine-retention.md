# Analytics Rollups, Engine, and Retention Implementation Plan

**Goal:** Ship roadmap stages 4–6: daily rollups + aggregator, an optional Analytics Engine emit sink, and documented raw-event retention.

**Architecture:** Aggregator incrementally folds `redirect_event` into daily/dimension rollups. `getLinkStats` reads rollups after the first successful run, otherwise raw events. `recordClick` writes an Analytics Engine data point when `ANALYTICS` is bound **and** still enqueues or persists D1. Retention deletes only rolled-up raw rows.

## Constraints

- One Worker. Default `wrangler.jsonc` stays free of required cron, AE, and retention vars.
- Do not write aggregation state on an empty first run.
- Do not increment rollups from `persistClicks`.
- After code changes run `pnpm format:fix`.
