# Configuration

Shorty Link is configured through Wrangler bindings, Wrangler vars, and Worker secrets.

`wrangler.jsonc` is committed as the canonical application config and self-hosting starter. It should keep app-owned settings stable while letting operators edit deployment-owned values.

App-owned settings:

- `main`
- `compatibility_date`
- `compatibility_flags`
- binding names such as `DB` and `AI`
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
