# Hosted MCP API Design

Date: 2026-09-06

## Goal

Ship a hosted Model Context Protocol (MCP) API on the existing Shorty Link Cloudflare Worker so Claude and ChatGPT hosted chat can connect with user OAuth, every tool call respects Shorty Link roles and scopes, admins can enable or disable the server and individual user access, and users can revoke MCP grants they have authorized.

## Constraints

- Remain one deployable Worker. No Durable Objects, KV, or extra apps.
- Reuse Better Auth passkeys. Do not add password login.
- Keep admin API under `/api/admin/*` with Elysia `t` validation and Eden clients.
- Use TanStack Form for admin forms and `src/lib/i18n.ts` for user-facing copy.
- Preserve current redirect behavior and reserved-path rules.
- D1 migrations stay append-only.

## Chosen approach

Use Better Auth 1.6's built-in `mcp()` plugin as the OAuth 2.1 authorization server (authorization code + PKCE + dynamic client registration). Serve a stateless Streamable HTTP MCP endpoint at `/mcp`. Persist OAuth clients, tokens, and consents in D1. Gate the server and per-user access with Shorty Link settings, not a second identity system.

Rejected alternatives:

- Cloudflare `McpAgent` + Workers OAuth Provider: needs Durable Objects and KV, and typically a third-party IdP instead of existing passkeys.
- Better Auth 1.7 `@better-auth/mcp` + CIMD: newer MCP 2026-07-28 profile, but it is a breaking auth upgrade and is not required for Claude/ChatGPT hosted connectors that still use DCR.

## Architecture

```text
Claude / ChatGPT
    |  GET /.well-known/oauth-protected-resource
    |  GET /.well-known/oauth-authorization-server
    |  POST /api/auth/mcp/register   (DCR)
    |  GET  /api/auth/mcp/authorize  (passkey login + consent)
    |  POST /api/auth/mcp/token
    v
POST /mcp  Bearer access token
    -> verify token (Better Auth getMcpSession)
    -> require MCP server enabled
    -> require user.mcpAccessEnabled and user.isActive
    -> load AuthContext (role, permissions, domain/link scopes)
    -> JSON-RPC tools/list and tools/call
    -> existing link/domain/analytics services
```

## Public endpoints

| Path | Role |
| --- | --- |
| `POST /mcp` | Stateless MCP Streamable HTTP. JSON-RPC `initialize`, `tools/list`, `tools/call`, `ping`. |
| `OPTIONS /mcp` | CORS preflight. |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 alias of Better Auth metadata. |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 alias. Resource identifier is `{origin}/mcp`. |
| `GET /.well-known/oauth-protected-resource/mcp` | Path-inserted RFC 9728 alias. |
| `/api/auth/mcp/*` | Better Auth MCP authorize, token, register, userinfo, jwks. |
| `/admin` | Existing passkey login. MCP plugin `loginPage`. |
| `/admin/mcp/consent` | Custom consent screen. MCP plugin `consentPage`. |

Unauthenticated `/mcp` calls return HTTP 401 JSON-RPC with `WWW-Authenticate: Bearer resource_metadata="{origin}/.well-known/oauth-protected-resource"`. CORS exposes that header. Discovery, register, token, and `/mcp` allow browser clients (`Access-Control-Allow-Origin: *` on those routes only).

## Data model

New D1 objects:

- `app_setting(key, value, updated_at)` — `mcp.enabled` defaults to `false`.
- `user.mcp_access_enabled` — boolean, default `true`.
- Better Auth OIDC tables: `oauthApplication`, `oauthAccessToken`, `oauthConsent`.

New permission: `mcp.manage`. System owner and admin roles receive it. Custom roles do not unless an admin adds it.

## Admin and user controls

Admin (`mcp.manage`):

- Enable or disable the MCP server globally.
- Enable or disable MCP access for an individual user.
- Disabling a user revokes that user's MCP consents and access tokens immediately.
- Disabling the server rejects authorize, token, register, and `/mcp` until re-enabled. Existing consents remain so users do not re-consent after a temporary outage.

User (any signed-in user):

- List MCP clients they have authorized.
- Revoke any grant. Revoke deletes consent and that client's tokens for the user.

## Permission model for tools

Tools are advertised and executed from the authenticated user's `AuthContext`. Missing permission or out-of-scope data is a tool error, not a leaked record.

| Tool | Permission | Scope |
| --- | --- | --- |
| `whoami` | none | identity only |
| `list_links` | `links.read` | domain/link scope |
| `get_link` | `links.read` | domain/link scope |
| `create_link` | `links.write` | hostname must be in domain scope |
| `update_link` | `links.write` | domain/link scope |
| `delete_link` | `links.delete` | domain/link scope |
| `list_domains` | `domains.read` | domain scope |
| `get_link_stats` | `analytics.read` | domain/link scope |

No user, role, or invite mutation tools.

## Admin API

- `GET /api/admin/mcp/settings`
- `PUT /api/admin/mcp/settings` body `{ enabled: boolean }`
- `PATCH /api/admin/users/:id` accepts `mcpAccessEnabled`
- `GET /api/admin/mcp/grants` — current user's grants
- `DELETE /api/admin/mcp/grants/:id` — revoke current user's grant

## UI

- Access tab **MCP** at `/admin/access/mcp` for server enable/disable and connector URL.
- User edit toggle **MCP access**.
- Account tab **MCP access** at `/admin/user/mcp` for grant revoke.
- Consent page at `/admin/mcp/consent`.

## Testing

- Unit: settings default, enable/disable, per-user revoke, tool catalog filtering, protocol initialize/list/call, 401 challenge.
- D1 integration: scoped list/create/delete through MCP tools.
- UI: admin enable, user revoke, consent copy.
- `pnpm test`, `pnpm typecheck`, `pnpm build`.
