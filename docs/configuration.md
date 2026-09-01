# Configuration

Shorty Link is configured through Wrangler bindings, Wrangler vars, and Worker secrets.

`wrangler.jsonc` is committed as the canonical application config and self-hosting starter. It should keep app-owned settings stable while letting operators edit deployment-owned values.

App-owned settings:

- `main`
- `compatibility_date`
- `compatibility_flags`
- binding names such as `DB`, `AI`, and optional `ANALYTICS_QUEUE` / `ANALYTICS`
- `migrations_dir`
- observability and source-map settings

Operator-owned settings:

- `name`
- `d1_databases[0].database_name`
- `d1_databases[0].database_id`
- `vars.BETTER_AUTH_ALLOWED_HOSTS`
- `vars.BETTER_AUTH_FALLBACK_URL`
- `vars.PASSKEY_RP_NAME`
- `vars.PASSKEY_RP_ID`

## Required Bindings

### `DB`

Cloudflare D1 database binding used by Better Auth, links, domains, invites, API keys, and analytics.

`wrangler.jsonc` must include:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "shorty-link",
    "database_id": "replace-with-your-d1-database-id",
    "migrations_dir": "./migrations"
  }
]
```

If you change `database_name`, update the `db:migrate:*` scripts in `package.json` or run the matching Wrangler command manually.

Keep the binding name as `DB`; the server code expects that binding.

### `AI`

Optional Workers AI binding used for slug suggestions. The core shortener works without AI-backed suggestions if the feature is not used.

### `ANALYTICS_QUEUE`

Optional Cloudflare Queues producer binding. When present, redirect analytics are enqueued and the same Worker consumes batches into D1. When absent, `recordClick` keeps writing D1 directly inside `waitUntil`.

Create the queue and dead-letter queue first:

```bash
pnpm exec wrangler queues create shorty-link-analytics
pnpm exec wrangler queues create shorty-link-analytics-dlq
```

Then add this block to `wrangler.jsonc`:

```jsonc
"queues": {
  "producers": [
    {
      "binding": "ANALYTICS_QUEUE",
      "queue": "shorty-link-analytics"
    }
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

Keep the binding name as `ANALYTICS_QUEUE`. Queue names are operator-owned. After adding the binding, regenerate types if you want the producer on the generated `Env`:

```bash
pnpm cf-typegen
```

The application still treats the binding as optional at runtime, so default deploys without this block keep working.

### `ANALYTICS`

Optional Workers Analytics Engine dataset binding. When present, `recordClick` writes one data point (not awaited) **and** still enqueues or persists to D1. The admin dashboard does not query Analytics Engine; D1 remains the source of truth.

Enabling `ANALYTICS` also copies click metadata (referer, user agent, city, country, UTMs, and target URL — not `ipHash`) into a Cloudflare account–level dataset. Anyone with Analytics Engine SQL/GraphQL access on that account can query every link’s clicks. That path does not use Better Auth, link/domain scope, or `analytics.read`. Treat the binding as an explicit export of admin analytics, not a drop-in observability toggle.

Add this block to `wrangler.jsonc`:

```jsonc
"analytics_engine_datasets": [
  {
    "binding": "ANALYTICS",
    "dataset": "shorty_link_clicks"
  }
]
```

Keep the binding name as `ANALYTICS`. The dataset name is operator-owned. After adding the binding, regenerate types if you want the dataset on the generated `Env`:

```bash
pnpm cf-typegen
```

Data-point layout for SQL/GraphQL queries:

- `index1`: link id
- `double1`: HTTP status code
- `blob1`–`blob13`: hostname, slug, country, city, colo, referer, user agent, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, target URL

### Analytics aggregator cron

Optional Cron Trigger that runs the analytics aggregator. When enabled, the Worker `scheduled` handler folds unaggregated `redirect_event` rows into `redirect_event_daily` and `redirect_event_dimension_daily`, then marks those rows aggregated. The dashboard reads rollups plus any events that are still unaggregated, so clicks stay visible between cron runs.

Add this block to `wrangler.jsonc`:

```jsonc
"triggers": {
  "crons": ["*/5 * * * *"]
}
```

The schedule is operator-owned. The default deploy works without a cron.

## Required Secrets

### `BETTER_AUTH_SECRET`

Required. Set this as a Worker secret:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
```

Use a strong random value. Do not commit production secrets.

## Wrangler Vars

### `BETTER_AUTH_ALLOWED_HOSTS`

Comma-separated hostnames Better Auth may trust.

Example:

```text
links.example.com,admin.example.com
```

For local development, `.dev.vars.example` includes `localhost:3000`, `localhost:8787`, and `*.workers.dev`.

### `BETTER_AUTH_FALLBACK_URL`

Fallback origin used for Better Auth dynamic base URL resolution.

Example:

```text
https://links.example.com
```

### `PASSKEY_RP_NAME`

Display name shown in passkey prompts.

### `PASSKEY_RP_ID`

Optional WebAuthn relying party ID. Usually this is your registrable domain, such as:

```text
example.com
```

## Optional Vars

### `DEBUG_AUTH_ERRORS`

When set to `"true"`, includes detailed error output for failed passkey authentication in server logs. Leave unset or set to any other value in production to avoid leaking error details.

### `ANALYTICS_RAW_EVENT_RETENTION_DAYS`

Optional. When set to a positive integer, the aggregator deletes raw `redirect_event` rows that have already been rolled up and are older than that many days. Unset, `0`, or a negative value keeps raw events forever.

Dashboards use rollups after the first successful aggregation. Raw events remain a detail log (recent clicks). Enable a cron trigger before relying on retention; events that have not been aggregated are never deleted.

## Local Variables

For local development:

```bash
cp .dev.vars.example .dev.vars
```

Then set a local `BETTER_AUTH_SECRET` in `.dev.vars`.

## Binding Type Generation

After changing Wrangler bindings, regenerate Cloudflare environment types:

```bash
pnpm cf-typegen
```

To build and validate the Worker upload before deployment:

```bash
pnpm deploy:dry-run
```
