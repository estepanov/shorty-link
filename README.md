# Shorty Link

Shorty Link is a single-deploy URL shortener for Cloudflare Workers. It combines:

- Elysia for redirect paths and the admin JSON API
- TanStack Start for the admin UI
- Eden for type-safe admin API calls
- Better Auth passkey-first admin authentication
- Optional Better Auth API keys for admin API access
- Drizzle ORM on Cloudflare D1
- Tailwind CSS v4

Password login and password account creation are intentionally disabled.

## Quick Start

Install dependencies:

```bash
pnpm install
```

Create a D1 database:

```bash
pnpm exec wrangler d1 create shorty-link
```

Copy the returned `database_id` into `wrangler.jsonc`.

Create a local env file:

```bash
cp .dev.vars.example .dev.vars
```

Set a real auth secret:

```bash
pnpm secret:auth
```

Apply the fresh schema locally:

```bash
pnpm db:migrate:local
```

Run the app:

```bash
pnpm dev
```

Open `http://localhost:3000/admin`, create the first admin, and register a passkey.

## Deploy

Apply the schema remotely:

```bash
pnpm db:migrate:remote
```

Deploy one Worker:

```bash
pnpm deploy
```

Add each custom redirect hostname as a Cloudflare Worker custom domain or route that points to this Worker. In the admin UI, create a domain entry for host-specific links. Links scoped to a hostname win first; default-host links are fallback links for all hostnames.

## Configuration

Important Wrangler bindings and vars:

- `DB`: Cloudflare D1 database binding.
- `AI`: optional Workers AI binding used for slug suggestions.
- `BETTER_AUTH_SECRET`: required secret, set with `wrangler secret put`.
- `BETTER_AUTH_ALLOWED_HOSTS`: comma-separated hosts Better Auth may trust, such as `links.example.com,admin.example.com,*.workers.dev`.
- `BETTER_AUTH_FALLBACK_URL`: fallback origin for Better Auth dynamic base URL resolution.
- `PASSKEY_RP_ID`: optional WebAuthn RP ID, usually your registrable domain.
- `PASSKEY_RP_NAME`: display name for passkey prompts.

## Common Commands

```bash
pnpm dev                # local development
pnpm build              # production build
pnpm preview            # preview built Worker
pnpm test               # unit tests
pnpm typecheck          # TypeScript check
pnpm cf-typegen         # generate Cloudflare binding types
pnpm db:migrate:local   # apply local D1 schema
pnpm db:migrate:remote  # apply remote D1 schema
pnpm deploy             # build and deploy
```

## Routes

- `/admin`: admin dashboard
- `/admin/profile`: profile name, email, and locale
- `/admin/sessions`: session management
- `/admin/api-keys`: optional admin API key management
- `/admin/invite/:token`: passkey-first invite acceptance
- `/api/auth/*`: Better Auth
- `/api/admin/*`: Elysia admin API with Server-Timing headers
- `/:slug`: redirect lookup for non-reserved paths

Reserved paths include `/admin`, `/api`, static asset paths, `favicon.ico`, and `robots.txt`.

## Development Notes

This repo assumes a fresh app and does not preserve old migrations. The first migration creates the full schema.

For passkey-first onboarding, the admin UI asks the Elysia API for a short-lived signed onboarding context. Better Auth's passkey plugin verifies that context and creates the admin user during passkey registration.

For API keys, Better Auth can turn a valid `x-api-key` into an admin API session. Keep API keys scoped to trusted automation.
