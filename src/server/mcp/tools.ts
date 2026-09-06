import type { Permission } from "@/lib/permissions";
import type { AuthContext } from "../auth/session";
import {
	assertHostnameInScope,
	assertLinkInScope,
	buildDomainScopeForCtx,
	buildLinkScopeForCtx,
} from "../auth/session";
import type { AppDb } from "../db/client";
import { getLinkStats } from "../services/analytics/stats";
import {
	deleteLink,
	getLinkById,
	listDomains,
	listShortLinks,
	saveLink,
} from "../services/links";

export type McpToolContent = { type: "text"; text: string };

export type McpToolResult = {
	content: McpToolContent[];
	isError?: boolean;
};

export type McpToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	permission?: Permission;
};

export type McpToolHandler = (input: {
	args: Record<string, unknown>;
	ctx: AuthContext;
	db: AppDb;
}) => Promise<McpToolResult>;

function textResult(value: unknown, isError = false): McpToolResult {
	return {
		content: [
			{
				type: "text",
				text:
					typeof value === "string" ? value : JSON.stringify(value, null, 2),
			},
		],
		...(isError ? { isError: true } : {}),
	};
}

function asString(value: unknown) {
	return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown) {
	return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

async function readErrorMessage(error: unknown) {
	if (error instanceof Response) {
		const body = await error.text().catch(() => "");
		try {
			const parsed = JSON.parse(body) as { key?: string };
			return parsed.key ?? body ?? "errors.permissionDenied";
		} catch {
			return body || "errors.permissionDenied";
		}
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "errors.unknown";
}

const toolCatalog: Array<McpToolDefinition & { handler: McpToolHandler }> = [
	{
		name: "whoami",
		description:
			"Return the authenticated Shorty Link user, role, and permissions.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: async ({ ctx }) =>
			textResult({
				id: ctx.user.id,
				email: ctx.user.email,
				name: ctx.user.name,
				role: ctx.role,
				permissions: [...ctx.permissions],
			}),
	},
	{
		name: "list_links",
		description: "List short links visible to the current user.",
		permission: "links.read",
		inputSchema: {
			type: "object",
			properties: {
				search: { type: "string" },
				hostname: { type: "string" },
				page: { type: "integer", minimum: 1 },
				pageSize: { type: "integer", minimum: 1, maximum: 100 },
				active: { type: "string", enum: ["active", "inactive", "all"] },
			},
			additionalProperties: false,
		},
		handler: async ({ args, ctx, db }) => {
			const scope = await buildLinkScopeForCtx(ctx);
			const result = await listShortLinks(
				db,
				{
					search: asString(args.search),
					hostname: asString(args.hostname),
					page: asNumber(args.page),
					pageSize: asNumber(args.pageSize),
					active:
						args.active === "active" ||
						args.active === "inactive" ||
						args.active === "all"
							? args.active
							: "all",
				},
				scope,
			);
			return textResult(result);
		},
	},
	{
		name: "get_link",
		description: "Get one short link by id if the user can see it.",
		permission: "links.read",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", minLength: 1 },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async ({ args, ctx, db }) => {
			const id = asString(args.id);
			if (!id) {
				return textResult("id is required", true);
			}
			const link = await getLinkById(db, id);
			if (!link) {
				return textResult("errors.linkMissing", true);
			}
			await assertLinkInScope(ctx, link);
			return textResult(link);
		},
	},
	{
		name: "create_link",
		description: "Create a short link. Hostname must be in the user's scope.",
		permission: "links.write",
		inputSchema: {
			type: "object",
			properties: {
				targetUrl: { type: "string", minLength: 1 },
				slug: { type: "string" },
				hostname: { type: "string" },
				title: { type: "string" },
				notes: { type: "string" },
				statusCode: { type: "integer" },
				preserveQueryParams: { type: "boolean" },
				isActive: { type: "boolean" },
			},
			required: ["targetUrl"],
			additionalProperties: false,
		},
		handler: async ({ args, ctx, db }) => {
			const targetUrl = asString(args.targetUrl);
			if (!targetUrl) {
				return textResult("targetUrl is required", true);
			}
			const hostname = asString(args.hostname);
			if (hostname) {
				await assertHostnameInScope(ctx, hostname);
			} else if (ctx.domainScope) {
				return textResult("errors.linkScopeRequiresDomain", true);
			}
			const id = await saveLink(db, {
				targetUrl,
				slug: asString(args.slug),
				hostname,
				title: asString(args.title),
				notes: asString(args.notes),
				statusCode: asNumber(args.statusCode),
				preserveQueryParams: asBoolean(args.preserveQueryParams),
				isActive: asBoolean(args.isActive),
				createdBy: ctx.user.id,
			});
			const link = await getLinkById(db, id);
			return textResult(link);
		},
	},
	{
		name: "update_link",
		description: "Update a short link the user can manage.",
		permission: "links.write",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", minLength: 1 },
				targetUrl: { type: "string", minLength: 1 },
				slug: { type: "string" },
				hostname: { type: "string" },
				title: { type: "string" },
				notes: { type: "string" },
				statusCode: { type: "integer" },
				preserveQueryParams: { type: "boolean" },
				isActive: { type: "boolean" },
			},
			required: ["id", "targetUrl"],
			additionalProperties: false,
		},
		handler: async ({ args, ctx, db }) => {
			const id = asString(args.id);
			const targetUrl = asString(args.targetUrl);
			if (!id || !targetUrl) {
				return textResult("id and targetUrl are required", true);
			}
			const existing = await getLinkById(db, id);
			if (!existing) {
				return textResult("errors.linkMissing", true);
			}
			await assertLinkInScope(ctx, existing);
			const hostname = asString(args.hostname) ?? existing.hostname;
			await assertHostnameInScope(ctx, hostname);
			await saveLink(db, {
				id,
				targetUrl,
				slug: asString(args.slug),
				hostname,
				title: asString(args.title),
				notes: asString(args.notes),
				statusCode: asNumber(args.statusCode),
				preserveQueryParams: asBoolean(args.preserveQueryParams),
				isActive: asBoolean(args.isActive),
			});
			const link = await getLinkById(db, id);
			return textResult(link);
		},
	},
	{
		name: "delete_link",
		description: "Delete a short link the user can manage.",
		permission: "links.delete",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", minLength: 1 },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async ({ args, ctx, db }) => {
			const id = asString(args.id);
			if (!id) {
				return textResult("id is required", true);
			}
			const existing = await getLinkById(db, id);
			if (!existing) {
				return textResult("errors.linkMissing", true);
			}
			await assertLinkInScope(ctx, existing);
			await deleteLink(db, id);
			return textResult({ ok: true, id });
		},
	},
	{
		name: "list_domains",
		description: "List managed domains visible to the current user.",
		permission: "domains.read",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: async ({ ctx, db }) => {
			const domains = await listDomains(db, buildDomainScopeForCtx(ctx));
			return textResult(domains);
		},
	},
	{
		name: "get_link_stats",
		description: "Get click analytics for a short link the user can see.",
		permission: "analytics.read",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", minLength: 1 },
				days: { type: "integer", minimum: 1, maximum: 180 },
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async ({ args, ctx, db }) => {
			const id = asString(args.id);
			if (!id) {
				return textResult("id is required", true);
			}
			const link = await getLinkById(db, id);
			if (!link) {
				return textResult("errors.linkMissing", true);
			}
			await assertLinkInScope(ctx, link);
			const stats = await getLinkStats(db, id, { days: asNumber(args.days) });
			return textResult({ link, stats });
		},
	},
];

export function listMcpTools(permissions: ReadonlySet<Permission>) {
	return toolCatalog
		.filter((tool) => !tool.permission || permissions.has(tool.permission))
		.map(({ name, description, inputSchema }) => ({
			name,
			description,
			inputSchema,
		}));
}

export async function callMcpTool(
	name: string,
	args: Record<string, unknown>,
	ctx: AuthContext,
	db: AppDb,
): Promise<McpToolResult> {
	const tool = toolCatalog.find((item) => item.name === name);
	if (!tool) {
		return textResult(`Unknown tool: ${name}`, true);
	}
	if (tool.permission && !ctx.permissions.has(tool.permission)) {
		return textResult("errors.permissionDenied", true);
	}
	try {
		return await tool.handler({ args, ctx, db });
	} catch (error) {
		return textResult(await readErrorMessage(error), true);
	}
}
