import { Elysia, t } from "elysia";

import { createAuth } from "../auth/auth";
import { assertTrustedAdminWrite } from "../auth/security";
import { createDb } from "../db/client";
import { listMcpGrants, revokeMcpGrant } from "../services/mcp-grants";
import {
	getMcpSettings,
	setMcpServerEnabled,
	toMcpSettingsResponse,
} from "../services/mcp-settings";
import {
	requireAuthOrError,
	requirePermissionOrError,
	requireSecurePermissionOrError,
} from "./require-auth";

export const mcpAdminRoutes = new Elysia({ name: "mcp-admin" })
	.get(
		"/mcp/settings",
		async ({ request }) => {
			await requirePermissionOrError(request, "mcp.manage");
			const settings = await getMcpSettings(createDb());
			return toMcpSettingsResponse(settings, new URL(request.url).origin);
		},
		{
			detail: { tags: ["MCP"], summary: "Get MCP server settings" },
		},
	)
	.put(
		"/mcp/settings",
		async ({ body, request }) => {
			await requireSecurePermissionOrError(request, "mcp.manage");
			const db = createDb();
			await setMcpServerEnabled(db, body.enabled);
			const settings = await getMcpSettings(db);
			return toMcpSettingsResponse(settings, new URL(request.url).origin);
		},
		{
			detail: { tags: ["MCP"], summary: "Update MCP server settings" },
			body: t.Object({
				enabled: t.Boolean(),
			}),
		},
	)
	.get(
		"/mcp/consent",
		async ({ query, request }) => {
			await requireAuthOrError(request);
			const signedQuery = new URLSearchParams(query.oauth_query);
			const clientId = signedQuery.get("client_id");
			if (!clientId) {
				throw new Error("errors.mcpConsentMissing");
			}
			const client = await createAuth(request).api.getOAuthClientPublicPrelogin(
				{
					body: {
						client_id: clientId,
						oauth_query: query.oauth_query,
					},
				},
			);
			return {
				clientId,
				clientName: client.client_name?.trim() || clientId,
				scopes: (signedQuery.get("scope") ?? "")
					.split(/\s+/)
					.map((scope) => scope.trim())
					.filter(Boolean),
			};
		},
		{
			detail: {
				tags: ["MCP"],
				summary: "Load MCP consent details for the current user",
			},
			query: t.Object({
				oauth_query: t.String({ minLength: 1 }),
			}),
		},
	)
	.get(
		"/mcp/grants",
		async ({ request }) => {
			const ctx = await requireAuthOrError(request);
			return listMcpGrants(createDb(), ctx.user.id);
		},
		{
			detail: { tags: ["MCP"], summary: "List current user MCP grants" },
		},
	)
	.delete(
		"/mcp/grants/:id",
		async ({ params, request }) => {
			assertTrustedAdminWrite(request);
			const ctx = await requireAuthOrError(request);
			await revokeMcpGrant(createDb(), ctx.user.id, params.id);
			return { ok: true };
		},
		{
			detail: { tags: ["MCP"], summary: "Revoke a current user MCP grant" },
			params: t.Object({ id: t.String({ minLength: 1 }) }),
		},
	);
