---
title: Roadmap
---

# Roadmap

Shorty Link starts as one Cloudflare Worker because that is the right default for self-hosting: one deploy, one D1 database, one set of bindings, and one clear upgrade path.

The roadmap is to keep that simple baseline while growing toward a more polished multi-service Cloudflare architecture. The split should happen only when it improves reliability, security, or operator experience enough to justify the extra deployable apps.

## Current baseline

| Area | Today | Docs |
| --- | --- | --- |
| Deployment | One Cloudflare Worker serves redirects, admin, API, and auth. | [Overview](/overview/), [Self-Hosting](/self-hosting/) |
| Runtime config | One `wrangler.jsonc`, one D1 binding, one Workers AI binding. | [Configuration](/configuration/) |
| API surface | Admin APIs live under `/api/admin/*` with Server-Timing. | [Admin API](/admin-api/) |
| Release model | Pre-1.0 releases may contain breaking changes. | [Releases](/releases/), [Upgrading](/upgrading/) |

## Roadmap items

| Item | Status | Summary | Details |
| --- | --- | --- | --- |
| Multi-service architecture | Target | Split the app into redirector, admin, and docs deployments once the operational value is clear. | [Architecture plan](/roadmap/multi-service-architecture/) |
| Redirector extraction | Planned | Keep the public redirect path small, fast, and independent from admin UI deploy risk. | [Redirector target](/roadmap/multi-service-architecture/#redirector) |
| Admin service boundary | Planned | Move TanStack Start, Better Auth, roles, invites, API keys, and management APIs behind an admin-focused deployable. | [Admin target](/roadmap/multi-service-architecture/#admin) |
| Independent docs deployment | Planned | Let documentation build and ship without touching the runtime application Worker. | [Docs target](/roadmap/multi-service-architecture/#docs) |
| Shared behavior modules | Planned | Extract normalization, redirect target construction, analytics event shape, and D1 schema in a way that does not pull UI or auth into the redirector. | [Shared code](/roadmap/multi-service-architecture/#shared-code) |
| Staged migration | Planned | Move one boundary at a time while preserving current redirect behavior and the self-hosted upgrade path. | [Migration path](/roadmap/multi-service-architecture/#migration-path) |

## Target shape

The intended destination is a small set of deployable apps:

- **Redirector:** public short-link resolution, domain fallback behavior, redirects, and analytics writes in `waitUntil`.
- **Admin:** dashboard, passkey authentication, roles, API keys, domains, links, invites, analytics views, and `/api/admin/*`.
- **Docs:** static documentation with its own build and deploy lifecycle.
- **Shared core:** schema, migrations, normalization, redirect construction, and types that must stay consistent across services.

## External references

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) for the runtime and routing model.
- [Cloudflare service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) for Worker-to-Worker calls when services need to communicate.
- [Cloudflare D1](https://developers.cloudflare.com/d1/) for the shared database layer.
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) for per-service deploy configuration.

## Guardrails

- Preserve simple self-hosting as long as possible.
- Keep redirects independent from admin UI deploy risk.
- Keep the public redirect path small, fast, and easy to audit.
- Add service boundaries only when they remove real operational risk.
- Avoid rebuilding the old split-app structure unless the new boundaries are clearly better than the current Worker.

## Status

This is a roadmap target, not the current deployment model. The current project still deploys as one Cloudflare Worker.
