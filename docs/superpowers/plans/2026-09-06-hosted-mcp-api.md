# Hosted MCP API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hosted, OAuth-protected MCP API on this Worker that Claude and ChatGPT can authorize against, with permission-aware tools plus admin and user access controls.

**Architecture:** Better Auth 1.6 `mcp()` issues OAuth tokens into D1. `POST /mcp` verifies those tokens, checks server/user flags, and runs a stateless JSON-RPC tool layer over existing link/domain/analytics services.

**Tech Stack:** Better Auth MCP plugin, Elysia admin API, Drizzle/D1, TanStack Start, Vitest.

## Global Constraints

- One Cloudflare Worker. No Durable Objects or KV.
- Better Auth 1.6 `mcp()` from `better-auth/plugins`. No password login.
- Admin API stays under `/api/admin/*` with Elysia `t` and Eden.
- User-facing strings go through `src/lib/i18n.ts`.
- After code changes run `pnpm format:fix`.
- Append-only D1 migrations.

---

### Task 1: Schema, settings, and grants

**Files:**
- Create: `migrations/0011_hosted_mcp.sql`
- Create: `src/server/services/mcp-settings.ts`
- Create: `src/server/services/mcp-grants.ts`
- Create: `test/mcp-access.test.ts`
- Modify: `src/server/db/schema.ts`
- Modify: `src/lib/permissions.ts`
- Modify: `src/server/services/users.ts`
- Modify: `src/server/auth/session.ts`

- [ ] Add OAuth tables, `app_setting`, `user.mcp_access_enabled`, and `mcp.manage`.
- [ ] Implement `getMcpSettings`, `setMcpServerEnabled`, `setUserMcpAccess`, `listMcpGrants`, `revokeMcpGrant`.
- [ ] Extract `loadAuthContextForUser(userId)`.
- [ ] Cover enable/disable and revoke with D1 tests.

### Task 2: MCP protocol and tools

**Files:**
- Create: `src/server/mcp/protocol.ts`
- Create: `src/server/mcp/tools.ts`
- Create: `src/server/mcp/handler.ts`
- Create: `src/server/mcp/cors.ts`
- Create: `test/mcp-protocol.test.ts`
- Create: `test/mcp-tools.test.ts`

- [ ] Implement JSON-RPC initialize / tools/list / tools/call / ping.
- [ ] Filter tools by permission and enforce scopes on each call.
- [ ] Handler returns 401 with RFC 9728 `WWW-Authenticate` when unauthenticated, 503 when the server is disabled, 403 when the user is denied.

### Task 3: Auth, routing, and admin API

**Files:**
- Modify: `src/server/auth/auth.ts`
- Modify: `src/lib/auth-client.ts`
- Modify: `src/server.ts`
- Modify: `src/server/api/app.ts`

- [ ] Register the Better Auth 1.7 `mcp({ loginPage: "/admin", resource, allowDynamicClientRegistration: true, allowUnauthenticatedClientRegistration: true, consentPage: "/admin/mcp/consent" })` plugin with `jwt()`.
- [ ] Block `/oauth2/authorize`, `/oauth2/token`, and `/oauth2/register` when the server is disabled.
- [ ] Route `/.well-known/*` and `/mcp` before redirects. Add CORS on those paths.
- [ ] Add `/api/admin/mcp/settings` and `/api/admin/mcp/grants`.

### Task 4: Admin UI and docs

**Files:**
- Create: `src/routes/admin.access.mcp.tsx`
- Create: `src/routes/admin.user.mcp.tsx`
- Create: `src/routes/admin.mcp.consent.tsx`
- Modify: `src/routes/admin.access.tsx`
- Modify: `src/components/account-tabs.tsx`
- Modify: `src/routes/admin.access.users.$id.edit.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `src/routeTree.gen.ts`
- Modify: `docs/overview.md`, `docs/usage.md`, `docs/admin-api.md`, `docs/upgrading.md`

- [ ] Server toggle, user toggle, grant revoke, consent screen.
- [ ] Document connector URL `{origin}/mcp` and the new permission.

### Task 5: Verify

- [ ] `pnpm format:fix && pnpm test && pnpm typecheck && pnpm build`
- [ ] Browser-check admin MCP settings, user revoke, and consent copy.
