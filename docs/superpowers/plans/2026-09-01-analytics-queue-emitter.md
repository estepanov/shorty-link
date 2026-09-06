# Analytics Queue Emitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Queues-backed `recordClick` path and a same-Worker consumer that writes the same analytics rows as the direct D1 path.

**Architecture:** `recordClick` enqueues when `ANALYTICS_QUEUE` is present and otherwise persists to D1. Persist logic is shared (`persistClicks`). The Worker `queue` handler consumes batches, retries invalid messages, and inserts with conflict-ignore so retries are idempotent.

**Tech Stack:** Cloudflare Workers, Cloudflare Queues, Drizzle + D1, Vitest, Wrangler `getPlatformProxy`

## Global Constraints

- One deployable Worker. Do not add `apps/redirector` or a second consumer app.
- Default `wrangler.jsonc` must not require a queue binding.
- Redirect response stays unblocked (`waitUntil` only).
- Password login/signup stay disabled.
- After code changes run `pnpm format:fix`.
- TDD: failing test first, then minimal implementation.

---

### Task 1: Queue message contract and binding probe

**Files:**
- Create: `src/server/services/analytics/record-click.ts` (extend existing)
- Create: `test/analytics-queue.test.ts`

**Interfaces:**
- Produces: `ANALYTICS_QUEUE_MESSAGE_VERSION`, `AnalyticsQueueMessage`, `getAnalyticsQueue(bindings: unknown)`, `toAnalyticsQueueMessage(input)`, `parseAnalyticsQueueMessage(body)`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
	ANALYTICS_QUEUE_MESSAGE_VERSION,
	getAnalyticsQueue,
	parseAnalyticsQueueMessage,
	toAnalyticsQueueMessage,
} from "../src/server/services/analytics/record-click";

const click = {
	linkId: "link-1",
	hostname: "__default__",
	slug: "go",
	targetUrl: "https://example.com",
	statusCode: 302,
};

describe("analytics queue message", () => {
	it("treats a missing or non-queue binding as absent", () => {
		expect(getAnalyticsQueue(undefined)).toBeUndefined();
		expect(getAnalyticsQueue({})).toBeUndefined();
		expect(getAnalyticsQueue({ ANALYTICS_QUEUE: "nope" })).toBeUndefined();
	});

	it("returns a binding that can send", () => {
		const queue = { send: async () => undefined };
		expect(getAnalyticsQueue({ ANALYTICS_QUEUE: queue })).toBe(queue);
	});

	it("round-trips a versioned click message", () => {
		const message = toAnalyticsQueueMessage(click);
		expect(message.v).toBe(ANALYTICS_QUEUE_MESSAGE_VERSION);
		expect(message.click).toEqual(click);
		expect(parseAnalyticsQueueMessage(message)).toEqual(message);
	});

	it("rejects invalid queue payloads", () => {
		expect(parseAnalyticsQueueMessage(null)).toBeNull();
		expect(parseAnalyticsQueueMessage({ v: 2, id: "x", createdAt: 1, click })).toBeNull();
		expect(
			parseAnalyticsQueueMessage({
				v: 1,
				id: "x",
				createdAt: 1,
				click: { ...click, linkId: 1 },
			}),
		).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm test test/analytics-queue.test.ts`
Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Add the message helpers to `record-click.ts`**

Keep existing `RecordClickInput` and `recordClick`. Add:

```ts
export const ANALYTICS_QUEUE_MESSAGE_VERSION = 1 as const;

export type AnalyticsQueueMessage = {
	v: typeof ANALYTICS_QUEUE_MESSAGE_VERSION;
	id: string;
	createdAt: number;
	click: RecordClickInput;
};

export function getAnalyticsQueue(
	bindings: unknown,
): Queue<AnalyticsQueueMessage> | undefined {
	if (typeof bindings !== "object" || bindings === null) return undefined;
	const queue = Reflect.get(bindings, "ANALYTICS_QUEUE");
	if (typeof queue !== "object" || queue === null) return undefined;
	if (typeof Reflect.get(queue, "send") !== "function") return undefined;
	return queue as Queue<AnalyticsQueueMessage>;
}

export function toAnalyticsQueueMessage(
	input: RecordClickInput,
): AnalyticsQueueMessage {
	return {
		v: ANALYTICS_QUEUE_MESSAGE_VERSION,
		id: nanoid(),
		createdAt: Date.now(),
		click: input,
	};
}

export function parseAnalyticsQueueMessage(
	body: unknown,
): AnalyticsQueueMessage | null {
	// validate v === 1, id string, createdAt finite number, required click fields
}
```

- [ ] **Step 4: Re-run tests**

Run: `pnpm test test/analytics-queue.test.ts`
Expected: PASS for the new describe block.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/analytics/record-click.ts test/analytics-queue.test.ts
git commit -m "feat(analytics): add queue message contract"
```

---

### Task 2: Shared persist + queue-aware `recordClick`

**Files:**
- Modify: `src/server/services/analytics/record-click.ts`
- Modify: `test/analytics-queue.test.ts`
- Test: existing `test/link-services.test.ts` must keep passing

**Interfaces:**
- Produces: `persistClicks(db, inputs)`, `recordClick(db, input, queue?)`
- `recordClick` default queue is `getAnalyticsQueue(env)` from `cloudflare:workers`

- [ ] **Step 1: Write failing tests for enqueue vs persist and idempotent persist**

Use the same `getPlatformProxy` + `applyD1Migrations` setup as `test/link-services.test.ts`.

Cases:
- `recordClick` without a queue writes one `redirect_event` and sets `hit_count` to 1 (can reuse existing test; add a focused one here).
- `recordClick` with a mock queue sends one `AnalyticsQueueMessage` and inserts no event row.
- `persistClicks` with two inputs for one link sets `hit_count` to 2.
- `persistClicks` of the same `id` twice inserts one row and leaves `hit_count` at 1.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm test test/analytics-queue.test.ts`
Expected: FAIL on missing `persistClicks` / unchanged `recordClick` signature.

- [ ] **Step 3: Extract `persistClicks` and dispatch in `recordClick`**

```ts
export async function persistClicks(
	db: AppDb,
	inputs: readonly PersistClickInput[],
): Promise<void> {
	if (inputs.length === 0) return;
	const rows = inputs.map(toEventRow);
	const inserted = await db
		.insert(redirectEvents)
		.values(rows)
		.onConflictDoNothing()
		.returning({
			id: redirectEvents.id,
			linkId: redirectEvents.linkId,
			createdAt: redirectEvents.createdAt,
		});
	// group inserted by linkId; increment hit_count; set lastClickAt/updatedAt
}

export async function recordClick(
	db: AppDb,
	input: RecordClickInput,
	queue: Queue<AnalyticsQueueMessage> | undefined = getAnalyticsQueue(env),
) {
	if (queue) {
		await queue.send(toAnalyticsQueueMessage(input));
		return;
	}
	await persistClicks(db, [input]);
}
```

`toEventRow` is the current insert-value builder. Accept optional `id` and `createdAt` on persist inputs so the consumer can reuse the producer values.

- [ ] **Step 4: Re-run analytics + link-services tests**

Run: `pnpm test test/analytics-queue.test.ts test/link-services.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/analytics/record-click.ts test/analytics-queue.test.ts
git commit -m "feat(analytics): persist clicks in batch and enqueue when bound"
```

---

### Task 3: Queue consumer and Worker handler

**Files:**
- Create: `src/server/services/analytics/consume-clicks.ts`
- Modify: `src/server.ts`
- Modify: `test/analytics-queue.test.ts`

**Interfaces:**
- Consumes: `parseAnalyticsQueueMessage`, `persistClicks`
- Produces: `consumeAnalyticsBatch(db, batch)`

- [ ] **Step 1: Write failing consumer tests**

Cases:
- Valid batch writes the same UTM / UA / schema version columns as direct persist and bumps `hit_count`.
- Invalid body calls `retry()` and writes nothing.
- Replaying the same message id does not increase `hit_count`.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm test test/analytics-queue.test.ts`
Expected: FAIL because `consumeAnalyticsBatch` is missing.

- [ ] **Step 3: Implement consumer and wire `queue` on the Worker**

```ts
export async function consumeAnalyticsBatch(
	db: AppDb,
	batch: { messages: readonly { body: unknown; retry: () => void }[] },
) {
	const valid = [];
	for (const message of batch.messages) {
		const parsed = parseAnalyticsQueueMessage(message.body);
		if (!parsed) {
			message.retry();
			continue;
		}
		valid.push({ ...parsed.click, id: parsed.id, createdAt: parsed.createdAt });
	}
	await persistClicks(db, valid);
}
```

In `src/server.ts` add `queue(batch, env)` that calls `consumeAnalyticsBatch(createDb(env.DB), batch)` and rethrows after logging so Cloudflare retries the batch.

- [ ] **Step 4: Re-run tests**

Run: `pnpm test test/analytics-queue.test.ts test/link-services.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/analytics/consume-clicks.ts src/server.ts test/analytics-queue.test.ts
git commit -m "feat(analytics): consume queued click batches"
```

---

### Task 4: Docs and operator config

**Files:**
- Modify: `docs/roadmap/analytics-pipeline.md`
- Modify: `docs/configuration.md`
- Modify: `docs/self-hosting.md`
- Modify: `docs/upgrading.md`
- Modify: `docs-site/src/lib/nav.ts`
- Modify: `wrangler.jsonc` (commented example only)

- [ ] **Step 1: Mark stage 3 done and document the opt-in binding**

Configuration snippet:

```jsonc
"queues": {
  "producers": [
    { "binding": "ANALYTICS_QUEUE", "queue": "shorty-link-analytics" }
  ],
  "consumers": [
    {
      "queue": "shorty-link-analytics",
      "max_batch_size": 100,
      "max_batch_timeout": 5,
      "max_retries": 5,
      "dead_letter_queue": "shorty-link-analytics-dlq"
    }
  ]
}
```

State clearly: no queue means today's direct D1 write. Creating the queue is operator-owned (`wrangler queues create`).

- [ ] **Step 2: Run format**

Run: `pnpm format:fix`

- [ ] **Step 3: Commit**

```bash
git add docs docs-site/src/lib/nav.ts wrangler.jsonc
git commit -m "docs: document optional analytics queue binding"
```
