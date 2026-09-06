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
| `/api/auth/mcp/*` | Authorize, token, dynamic client registration, userinfo |

Admin settings and grant revoke live under `/api/admin/mcp/*`. See [Admin API](/admin-api/#mcp).

## After upgrade

`0011_hosted_mcp.sql` adds the OAuth tables, `user.mcp_access_enabled`, the `mcp.enabled` setting (default off), and `mcp.manage` on system roles. Apply migrations, then enable the server only if you want connectors. See [Upgrading](/upgrading/).
