# Shorty Link Agent Notes

This repo is a single deployable Cloudflare Workers app.

Always use Context7 when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.


## Architecture

- `src/server.ts`: custom TanStack Start Worker entrypoint that routes `/api/*` and redirect candidates to Elysia, then falls back to TanStack Start.
- `src/server/api/app.ts`: Elysia app for Better Auth, admin API, and redirect resolution.
- `src/server/db/schema.ts`: Drizzle schema for Better Auth, passkeys, API keys, domains, links, invites, and analytics.
- `src/server/services/links.ts`: core URL shortener behavior.
- `src/routes/*`: TanStack Start admin UI.
- `migrations`: fresh D1 schema. Do not preserve old split-app migrations.

## Rules

- Keep this as one deployable Worker.
- Do not reintroduce `apps/admin`, `apps/redirector`, or `packages/core`.
- Use pnpm.
- Keep Tailwind enabled.
- Keep password login and password signup disabled.
- Use TanStack Form for admin forms.
- Use Eden for admin API calls where possible.
- Use Elysia `t` validation for API inputs.
- Keep admin API routes under `/api/admin/*` so Server-Timing applies consistently.
- Preserve redirect behavior: exact hostname+slug first, default hostname fallback second.
- Keep redirect writes in `waitUntil` and avoid request-scoped globals.
- After Wrangler binding changes, run `pnpm cf-typegen`.
- After saving any code changes, run `pnpm format:fix`.

## Typical Commands

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm db:migrate:local
pnpm deploy
```

## Cursor Cloud specific instructions

### Local development without Cloudflare auth

The `@cloudflare/vite-plugin` tries to establish a remote proxy for the AI binding. Without `CLOUDFLARE_API_TOKEN` set, this times out and crashes the dev server. The `vite.config.ts` conditionally sets `remoteBindings: false` when no token is available, allowing `pnpm dev` to work without Cloudflare credentials. The AI slug-suggestion feature will be unavailable (falls back to deterministic slug generation).

### Agent browser auth for testing

For headless/automated testing, enable `AGENT_BROWSER_AUTH_ENABLED=true` in `.dev.vars` and use the endpoint `GET /api/dev/agent-login?secret=<URL_ENCODED_SECRET>&redirect=/admin` to create a session without passkey interaction. The secret must match `AGENT_BROWSER_AUTH_SECRET` in `.dev.vars`.

### Admin API CSRF protection

POST/PUT/DELETE requests to `/api/admin/*` with cookie auth require an `Origin` header matching the request URL origin (CSRF protection). Requests without this header return 403.

### Pre-existing issues

- `pnpm lint` reports 6 pre-existing Biome errors and 5 warnings (mostly React hook dependency warnings).
- `pnpm test` has 1 pre-existing failure in `test/admin-api-wrappers.test.ts` (expects 403 but receives 400).
- A non-fatal `vite-tsconfig-paths` warning appears during dev about `docs-site/tsconfig.json` (astro not installed in root). This does not affect functionality.

### First-time local DB setup

Run `pnpm db:migrate:local` to apply D1 migrations before the first `pnpm dev`. The migrations create all tables including the `system_owner` role.
