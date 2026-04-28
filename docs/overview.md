---
title: Overview
---

# Shorty Link

A self-hosted URL shortener that ships as a single Cloudflare Worker.

One Worker handles redirects, the admin UI, the admin API, and authentication. One D1 database stores everything. One `pnpm deploy` puts it on your own Cloudflare account, on your own domains, with no third-party dependency in the request path.

## Why Shorty Link

- **Edge-fast redirects.** Lookups run inside Cloudflare Workers next to your users. Writes happen in `waitUntil` so analytics never block the redirect.
- **Single deployable.** No separate redirector service, no separate admin app, no message bus. The whole thing is one Worker bundle and one D1 database.
- **Passwordless from day one.** Authentication is passkey-only via Better Auth and WebAuthn. Password login and signup are disabled out of the box.
- **Multi-domain by design.** Route any number of hostnames to the Worker. Redirect resolution checks the exact hostname plus slug first, then falls back to a default-host entry — so the same slug can mean different things on different brands.
- **Your data, your account.** Everything lives in your Cloudflare D1 database. Fork the repo, deploy to your account, own the schema.
- **Open source, MIT.** Read the code. Audit the auth. Ship a fork.

## Features

### Links
- Custom slugs, or AI-generated suggestions backed by Cloudflare Workers AI.
- Configurable redirect status code per link: `301`, `302`, `303`, `307`, or `308`. Defaults to `302`.
- Per-link analytics with click tracking.
- Active/inactive toggling without deleting history.
- Bulk filter, search, and pagination in the admin UI.

### Domains
- Manage redirect hostnames from the admin UI.
- Host-specific link namespaces with a clean fallback rule.
- Add or remove hostnames without redeploying.

### Auth & Access
- Passkey registration and sign-in via Better Auth.
- Invite-based onboarding for additional admins.
- Session management with revoke-current and revoke-other-sessions.
- API keys with optional expiry for programmatic access (`x-api-key` or `Authorization`).
- Role-aware admin UI for users, invites, and permissions.

### Admin API
- Full REST surface under `/api/admin/*` for links, domains, users, invites, sessions, and API keys.
- Eden-typed client for type-safe internal calls.
- Server-Timing headers on every admin response.
- See the [Admin API reference](/admin-api/) for the complete endpoint list.

### Operator Experience
- `wrangler.jsonc` is committed as a starter config. App-owned settings stay stable; operator-owned values are clearly separated.
- D1 migrations are append-only after first release, with explicit upgrade notes.
- Release Please drives semver tags so production forks always have a clear upgrade target.
- GitHub Actions for PR checks, remote D1 migrations, and Worker deploys, gated behind a single repo variable so the public starter never deploys by accident.

## What it isn't

- **Not a SaaS.** There is no hosted service to sign up for. You run it on your own Cloudflare account.
- **Not multi-tenant.** One deployment, one organization, your team. Spin up another Worker if you need another tenant.
- **Not a marketing analytics suite.** Click counts and timestamps, not funnel attribution. If you need deep analytics, pipe events out from the Worker.

## Get started

1. Read the [Self-Hosting guide](/self-hosting/) for the full setup walkthrough.
2. Skim [Configuration](/configuration/) for the bindings and secrets you'll need.
3. Bookmark [Upgrading](/upgrading/) and [Releases](/releases/) before your first production deploy.

The shortest path:

```bash
pnpm install
pnpm exec wrangler d1 create shorty-link
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm db:migrate:remote
pnpm deploy
```

Then open `/admin` on your deployed hostname and create the first admin with a passkey.
