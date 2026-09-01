---
title: Analytics Pipeline
---

# Analytics Pipeline

Shorty Link records click analytics today by writing rows to D1 from the redirect handler inside `waitUntil`. That keeps the redirect response fast and the deployment simple, and it is the right default for self-hosters.

The roadmap target is to keep that baseline working while adding an opt-in path that scales better, batches writes, and lets analytics evolve independently of the redirector.

## Why evolve later

Direct D1 writes from the redirect path work well at low and moderate traffic. They become limiting when:

- Per-row D1 inserts dominate cost or hit write contention under bursts.
- Dashboard queries start scanning raw events instead of pre-aggregated rollups.
- Analytics schema changes require redeploying the redirector.
- Operators want raw events in a separate store from product data.

None of these are true for the default deployment, so the direct-write path stays supported.

## Target shape

The intended pipeline is a small set of opt-in pieces, each behind a binding so the single-Worker deployment keeps working when none are configured:

- **Emitter:** the redirector calls a single `recordClick` function. The implementation is selected by which bindings are present, not by code branches in the redirect path.
- **Event sink:** the destination for raw click events. Two supported targets:
  - Cloudflare Queues, consumed by a small Worker that batches inserts into D1.
  - Cloudflare Workers Analytics Engine, written directly from the emitter.
- **Consumer:** when Queues is the sink, the same Worker consumes the analytics queue, batches events, and writes them to the analytics tables. The consumer owns retry, dead-lettering, and batch sizing. A later split can move this handler to its own Worker without changing the message contract.
- **Aggregator:** a scheduled Worker (Cron Trigger) that builds rollups (per-link, per-day, per-hour, per-referrer) into D1 tables that the admin dashboard reads. Raw events are kept only as long as the configured retention window.
- **Reader:** admin analytics views read rollup tables for dashboards and fall back to raw events only for ad-hoc detail queries.

## Responsibilities

### Redirector

- Build the analytics event using the shared event shape.
- Call `recordClick` once per redirect, inside `waitUntil`.
- Never depend on the consumer or aggregator being deployed.

### Queue consumer (optional)

- Receive batched messages from the analytics queue in the same Worker `queue` handler.
- Insert into raw analytics tables in one `redirect_event` insert per batch.
- Send unrecoverable messages to a dead-letter queue via `retry()` after `max_retries`.
- Stay independent of admin code, auth, and UI.

### Aggregator (optional)

- Run on a Cron Trigger.
- Read raw events since the last successful run.
- Upsert rollup rows for the dashboard query patterns the admin actually uses.
- Apply the configured retention policy to raw events.

### Admin

- Read rollup tables for dashboard views.
- Treat raw event access as a detail-drill path, not the default query.

## Configuration

The pipeline is selected by bindings, not by feature flags in code:

- No queue binding and no Analytics Engine binding: direct D1 write in `waitUntil` (current behavior).
- `ANALYTICS_QUEUE` producer present: redirector enqueues, the same Worker consumes and writes to D1. Rollups still wait on the later aggregator stage.
- Analytics Engine binding present: redirector writes events directly to Analytics Engine, aggregator reads from Analytics Engine into D1 rollups.

Self-hosters who do not configure any of these bindings keep the current single-Worker behavior with no extra deployables.

## Event shape

The analytics event shape is shared code and must be stable before a queue or external sink is introduced. Consumers and aggregators are versioned independently of the redirector, so a breaking change to the event shape becomes a coordinated upgrade across services.

Fields the shape must cover:

- Link identity (link id and resolved hostname plus slug).
- Timestamp.
- Request metadata that the current analytics already records (referrer, user agent class, country, etc.).
- Schema version.

## Migration path

The split should happen in stages and remain reversible at each step.

1. **Done:** Extract `recordClick` into `src/server/services/analytics/record-click.ts` with a stable `RecordClickInput` contract. The only implementation today is still the direct D1 write inside `waitUntil`.
2. **Done:** Persist `event_schema_version` on each `redirect_event` row (`REDIRECT_EVENT_SCHEMA_VERSION` in `src/server/db/redirect-event-schema-version.ts`) so future queue consumers can branch on the stored shape.
3. **Done:** Add a Queues-backed implementation of `recordClick` plus a same-Worker `queue` consumer that writes the same rows the direct path writes. Select by `ANALYTICS_QUEUE` binding presence. Default deploys without a queue keep the direct D1 write.
4. Add the rollup tables and an aggregator Cron Trigger. Switch admin dashboard reads to the rollups.
5. Add an Analytics Engine implementation of `recordClick` as a second optional sink.
6. Document a retention policy for raw events once rollups are authoritative for dashboards.

Each stage preserves the redirect contract: the response is never blocked on analytics, and the redirector never requires the consumer or aggregator to be deployed.

## External references

- [Cloudflare Queues](https://developers.cloudflare.com/queues/) for the buffered analytics path.
- [Cloudflare Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) for high-cardinality time-series events.
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) for the aggregator schedule.
- [Cloudflare D1](https://developers.cloudflare.com/d1/) for rollup storage and dashboard reads.

## Guardrails

- The redirector must never block on analytics.
- The default deployment must keep working with no queue, no Analytics Engine, and no aggregator.
- The analytics event shape is a contract; breaking changes require a version bump.
- Dashboards read rollups, not raw events, once the aggregator is in place.
- Raw event retention is bounded once rollups are authoritative.

## Decision point

This should be implemented when one or more of these are true:

- D1 write cost or contention shows up under real traffic.
- Dashboard queries start scanning raw events at a size that affects latency.
- Operators ask for raw events in a separate store.
- Analytics schema changes start gating redirector deploys.

Until then, the direct `waitUntil` D1 write remains the supported default.
