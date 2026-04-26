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
