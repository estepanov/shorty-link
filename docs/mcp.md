---
title: MCP
---

# MCP

Claude and ChatGPT can manage Shorty Link through a hosted MCP server on the same Worker. Connections use passkey OAuth. Tools follow the signed-in user's role, permissions, and domain or link scopes.

The server is **off** until an admin enables it. No extra Wrangler bindings are required.

## Enable the server

1. Sign in as a user with the `mcp.manage` permission.
2. Open **Access → MCP**.
3. Turn **MCP server enabled** on and save.
4. Copy the connector URL: `https://your-host/mcp`.

Disabling the server rejects new OAuth and `POST /mcp` requests.

## Connect Claude or ChatGPT

1. In Claude or ChatGPT, add a custom MCP connector.
2. Paste the connector URL (`{origin}/mcp`).
3. Sign in with your Shorty Link passkey.
4. Allow the consent screen.

The client only receives tools your role already allows. Domain and link scopes still apply.

Claude and ChatGPT register OAuth clients from their own servers (dynamic client registration). Those requests never run JavaScript, so Cloudflare bot products that challenge automated traffic will make ChatGPT report `Dynamic client registration failed: registration endpoint returned 403`.

On the hostname you paste into the connector:

1. Turn **Bot Fight Mode** off. WAF Skip rules cannot bypass it.
2. Set **Block AI Bots** to allow (or disable it). ChatGPT is classified as an AI client.
3. Do not leave the zone in **I'm Under Attack**.

On a Pro plan or above you can keep Super Bot Fight Mode and add a WAF custom rule that **skips** it for `/mcp` and `/api/auth/oauth2/*`. On the Free plan the only fix is to turn Bot Fight Mode off.

Confirm the Worker is reachable before retrying the connector:

```bash
curl -sS -D - -o /tmp/dcr.json -X POST "$ORIGIN/api/auth/oauth2/register" \
  -H "Content-Type: application/json" \
  -d '{"client_name":"probe","redirect_uris":["https://chatgpt.com/connector_platform_oauth_redirect"],"token_endpoint_auth_method":"none"}'
```

A healthy response is `201` with JSON `client_id`. `403` plus `cf-mitigated: challenge` or a "Just a moment..." HTML body is still Cloudflare, not Shorty Link.

## Tools

| Tool | Permission |
| --- | --- |
| `whoami` | Any authenticated user |
| `list_links`, `get_link` | `links.read` |
| `create_link`, `update_link` | `links.write` |
| `delete_link` | `links.delete` |
| `list_domains` | `domains.read` |
| `get_link_stats` | `analytics.read` |

A user without a permission does not see that tool.

## Access control

- **Server.** Off by default. Toggle from **Access → MCP** (`mcp.manage`).
- **Per user.** New users can use MCP. Turn **Allow MCP access** off on **Access → Users** to block one person. That also revokes their MCP tokens.
- **Per client.** Users revoke a connector from **Profile → MCP access**.

## Endpoints

These paths are reserved and never used as short-link slugs:

| Path | Role |
| --- | --- |
| `POST /mcp` | Stateless Streamable HTTP MCP |
| `GET /.well-known/oauth-protected-resource` | Resource metadata (RFC 9728) |
| `GET /.well-known/oauth-authorization-server` | Authorization-server metadata |
| `GET /.well-known/openid-configuration` | OpenID discovery (and `/api/auth` path aliases) |
| `/api/auth/oauth2/*` | Authorize, token, dynamic client registration, userinfo |

Access-token checks load JWKS through the same Worker (`auth.handler`), not an HTTP fetch back to this hostname. Same-zone Worker fetches to the Worker's own origin fail or hang on Cloudflare.

If ChatGPT finishes consent and then reports a generic connector error, confirm `GET /api/auth/jwks` returns JSON keys and `POST /mcp` without a bearer token returns JSON-RPC `401` with `WWW-Authenticate`. A Worker `500` on an authenticated `/mcp` call is a token-verify bug, not another Cloudflare challenge.

Admin settings and grant revoke live under `/api/admin/mcp/*`. See [Admin API](/admin-api/#mcp).

## After upgrade

`0011_hosted_mcp.sql` adds the OAuth tables, `user.mcp_access_enabled`, the `mcp.enabled` setting (default off), and `mcp.manage` on system roles. Apply migrations, then enable the server only if you want connectors. See [Upgrading](/upgrading/).
