# CLAUDE.md

Shorty Link is a public, self-hosted Cloudflare Workers URL shortener. Treat the current architecture as a fresh single-app rewrite.

Use current primary docs for Cloudflare Workers, Elysia, Better Auth, TanStack Start, TanStack Form, and Drizzle before changing platform-specific APIs.

Key constraints:

- One Worker deployment from the repo root.
- Elysia handles `/api/auth/*`, `/api/admin/*`, and redirect slug requests.
- TanStack Start handles the admin UI under `/admin`.
- Better Auth is passkey-first. Do not add password sign-in or password signup.
- Admin API keys are optional and managed through Better Auth.
- D1 is the only database.
- i18n strings should go through `src/lib/i18n.ts`.
- Redirect host matching must remain hostname-aware with default fallback.

Useful files:

- `src/server/api/app.ts`
- `src/server/auth/auth.ts`
- `src/server/db/schema.ts`
- `src/server/services/links.ts`
- `src/routes/admin.tsx`
- `README.md`
