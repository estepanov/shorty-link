---
title: Multi-Service Architecture
---

# Multi-Service Architecture

Shorty Link currently ships as a single Cloudflare Worker. That keeps the first production deploy simple and makes the project easy to fork, inspect, and operate.

The roadmap target is a more polished multi-service deployment that separates the redirect hot path from the admin experience and documentation site.

## Why split later

The single-Worker model is still the right default today. The built Worker is comfortably below Cloudflare's documented size limits, and one deploy is easier for self-hosters to understand.

A multi-service architecture becomes valuable when the project needs stronger operational separation:

- Redirect traffic should not depend on admin UI deploys.
- The public redirect Worker should stay small and easy to audit.
- Admin auth, roles, API keys, OpenAPI, and dashboard code should evolve independently.
- Documentation should build and deploy without touching the runtime application.
- Observability should separate redirect latency from admin and authentication latency.

## Target services

### Redirector

The redirector is the public edge service for short links.

Responsibilities:

- Resolve hostname plus slug.
- Preserve the exact-hostname-first, default-hostname-fallback behavior.
- Build the redirect target and apply the configured status code.
- Write analytics with `waitUntil` so the redirect response is not blocked.
- Return domain root and unknown-slug fallback responses.

The redirector should avoid dashboard, auth, role, invite, and OpenAPI dependencies.

### Admin

The admin service owns the authenticated product surface.

Responsibilities:

- Render the TanStack Start admin UI.
- Serve `/api/admin/*`.
- Handle Better Auth passkey flows.
- Manage users, roles, invites, API keys, domains, links, and analytics views.
- Keep Server-Timing on admin API responses.

The admin service can share the same D1 database and schema, but it should not be required for public redirects to keep working.

### Docs

The docs service is a static documentation site.

Responsibilities:

- Publish product, setup, upgrade, API, and roadmap documentation.
- Deploy independently of the application Worker.
- Avoid runtime bindings that belong to redirects or admin.

## Shared code

Shared code should exist only where it protects behavior that must remain consistent across services.

Good candidates:

- D1 schema and migrations.
- Hostname and slug normalization.
- Redirect target construction.
- Analytics event shape.
- Shared TypeScript types for service boundaries.

Poor candidates:

- UI components shared with the redirector.
- Admin-only auth helpers inside the redirector.
- Broad packages that make every service depend on the whole application.

## Cloudflare shape

The intended Cloudflare deployment shape is:

- Separate Worker applications for redirector and admin.
- Separate routes or custom domains for public redirects and admin access.
- Service bindings only where Worker-to-Worker calls are necessary.
- One D1 database unless scale or tenancy requirements justify another store.
- Independent Wrangler configuration per deployable app.

Cloudflare service bindings are the preferred way for Workers to call each other because they avoid public HTTP as the integration boundary. Cloudflare's Git-based monorepo deploy model still treats each subdirectory as an isolated application, so the repository structure should make each deployable app self-contained.

## Migration path

The split should happen in stages.

1. Extract shared redirect behavior into small modules with no UI or auth dependencies.
2. Add a redirector Worker that can resolve links from the existing D1 schema.
3. Move public link routes to the redirector while keeping admin on the current Worker.
4. Move the admin runtime to its own app boundary.
5. Keep docs as an independent static deployment.
6. Remove compatibility code after one stable release cycle.

Each stage should preserve existing redirect behavior:

- Exact hostname plus slug wins first.
- Default hostname fallback is checked second.
- Query parameters are preserved only when the link allows it.
- Destination query parameters win on conflict.
- Analytics writes stay in `waitUntil`.

## Decision point

This should not be implemented just because the repository can be split. The split is worth doing when one or more of these are true:

- Redirect availability matters more than admin deploy velocity.
- Bundle growth starts to affect cold-start or deploy confidence.
- Admin auth and dashboard changes become risky to ship beside redirects.
- Operators ask for separate deploys, routes, or access controls.
- The docs site needs its own release cadence.

Until then, the single-Worker architecture remains the supported deployment model.
