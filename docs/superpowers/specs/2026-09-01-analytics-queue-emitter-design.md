---
title: Analytics Queue Emitter Design
---

# Analytics Queue Emitter

## Problem

Roadmap stage 3 of the [analytics pipeline](/roadmap/analytics-pipeline/) is unimplemented: a Queues-backed `recordClick` plus a consumer that writes the same `redirect_event` rows the direct D1 path writes.

Stages 1–2 are done (`recordClick` + `event_schema_version`). Stages 4–6 (rollups, Analytics Engine, retention) stay out of scope.

The multi-service split is also out of scope. `AGENTS.md` requires one deployable Worker.

## Goal

Operators can opt into Cloudflare Queues for click analytics without changing redirect behavior or forcing a queue on default self-hosters.

## Approaches

1. **Same-Worker producer + consumer, optional binding (recommended).** `recordClick` enqueues when `ANALYTICS_QUEUE` is present and writes D1 otherwise. The existing Worker exports a `queue` handler that persists batches. Default `wrangler.jsonc` stays queue-free.
2. **Separate consumer Worker.** Matches the long-term roadmap wording, but reintroduces a second deployable and violates the current one-Worker rule.
3. **Always-on queue in committed Wrangler config.** Gives generated types for free, but every self-hoster must create a queue before deploy.

Approach 1 is the one to implement.

## Design

### Selection

Bindings choose the sink. The redirect handler keeps calling `recordClick` inside `waitUntil`. It does not grow an `if (queue)` branch.

`recordClick(db, input)` reads the Worker env. If `ANALYTICS_QUEUE` is a queue (has `send`), it enqueues and returns. Otherwise it persists to D1, which is today's behavior.

Tests may pass an explicit queue as a third argument so they do not have to mutate the Cloudflare env mock.

### Persist path

Extract the current D1 write into `persistClicks(db, inputs)` so the direct path and the consumer share one writer.

- One or more `redirect_event` rows
- `short_link.hit_count` incremented by the number of newly inserted rows per link
- `last_click_at` / `updated_at` set from the event timestamp
- Same truncation and UA parsing as today

Producer assigns `id` and `createdAt` before enqueue so consume-time delay does not shift the click timestamp and retries can be idempotent.

### Queue message

```ts
type AnalyticsQueueMessage = {
	v: 1;
	id: string;
	createdAt: number;
	click: RecordClickInput;
};
```

`v` is the envelope version (`ANALYTICS_QUEUE_MESSAGE_VERSION`). Persisted `event_schema_version` stays `REDIRECT_EVENT_SCHEMA_VERSION`.

Unknown or invalid messages are `retry()`'d so Cloudflare can dead-letter them after `max_retries`. Valid messages persist; a persist failure throws so the batch retries.

Idempotency: insert with `ON CONFLICT DO NOTHING` and increment hit counts only for rows that were actually inserted.

### Consumer

The same Worker exports `queue`. It is a no-op unless an operator adds a consumer binding. `consumeAnalyticsBatch(db, batch)` parses, retries invalid messages, and calls `persistClicks`.

### Configuration

Do not add a live `queues` block to committed `wrangler.jsonc`. Document the opt-in snippet (producer `ANALYTICS_QUEUE`, consumer, DLQ) in `docs/configuration.md` and as a comment in `wrangler.jsonc`.

Binding type is optional and checked at runtime. Do not run `cf-typegen` against a binding that is not in the committed config.

### Non-goals

- Rollup tables or cron aggregator
- Analytics Engine sink
- Raw-event retention
- Separate consumer app
- Changing dashboard queries

## Testing

- Direct `recordClick` still writes D1 and UTM columns (existing test).
- `recordClick` with a queue sends one message and writes no D1 row.
- Consumer persists the same row shape and hit metadata as the direct path.
- Batch of two clicks on one link increments `hit_count` by 2.
- Duplicate `id` does not insert a second row or double-count hits.
- Invalid messages are retried and do not write rows.
- `getAnalyticsQueue` is undefined when the binding is missing or is not a queue.

## Docs

- Mark pipeline stage 3 done.
- Document the optional binding and Wrangler snippet.
- Mention the opt-in in self-hosting / upgrading as a non-breaking config addition.
