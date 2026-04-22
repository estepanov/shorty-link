---
name: shorty-link
description: Work on the Shorty Link open-source Cloudflare Workers URL shortener. Use when editing routing, auth, redirects, admin UI, D1 schema, or deployment docs.
---

# Shorty Link Skill

Use this skill when modifying this repository.

## Core Model

Shorty Link is one Cloudflare Worker. `src/server.ts` dispatches requests:

- `/api/*` goes to Elysia.
- Reserved UI/static paths go to TanStack Start.
- Other GET/HEAD paths are short-link redirect candidates.

## Preserve Behavior

- Normalize hostnames by parsing as URLs and lowercasing.
- Normalize slugs to lowercase letters, numbers, hyphens, and underscores.
- Resolve redirects by exact hostname+slug first.
- Fall back to `__default__` hostname for custom domains.
- Preserve query parameters only when the link enables it, with destination params winning.
- Analytics should store only safe UTM passthrough params.

## Auth Rules

- No password sign-in.
- No password signup.
- First admin and invites use passkey-first onboarding contexts.
- Admin profile may update name, email, and locale.
- API keys are optional and managed by Better Auth.

## UI Rules

- Admin forms should use TanStack Form.
- Admin API calls should use Eden where possible.
- User-facing strings should go through `src/lib/i18n.ts`.
- Keep Tailwind enabled and preserve accessible labels, buttons, and tables.

## Verification

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```
