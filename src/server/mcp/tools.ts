import type { Permission } from "@/lib/permissions";
import type { AuthContext } from "../auth/session";
import type { AppDb } from "../db/client";
import { getLinkById } from "../services/links";
import {
	createLinkForCtx,
	deleteLinkForCtx,
	fetchLinkInScope,
	getLinkStatsForCtx,
	listDomainsForCtx,
	listLinksForCtx,
	updateLinkForCtx,
} from "../services/scoped-links";

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

type McpToolHandler = (input: {
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

function requiredString(value: unknown, field: string) {
	const parsed = asString(value);
	if (!parsed) {
		return { ok: false as const, error: `${field} is required` };
	}
	return { ok: true as const, value: parsed };
}

function parseLinkWriteArgs(args: Record<string, unknown>, requireId = false) {
	const targetUrl = requiredString(args.targetUrl, "targetUrl");
	if (!targetUrl.ok) {
		return targetUrl;
	}
	if (requireId) {
		const id = requiredString(args.id, "id");
		if (!id.ok) {
			return id;
		}
		return {
			ok: true as const,
			value: {
				id: id.value,
				targetUrl: targetUrl.value,
				slug: asString(args.slug),
				hostname: asString(args.hostname),
				title: asString(args.title),
				notes: asString(args.notes),
				statusCode: asNumber(args.statusCode),
				preserveQueryParams: asBoolean(args.preserveQueryParams),
				isActive: asBoolean(args.isActive),
			},
		};
	}
	return {
		ok: true as const,
		value: {
			targetUrl: targetUrl.value,
			slug: asString(args.slug),
			hostname: asString(args.hostname),
			title: asString(args.title),
			notes: asString(args.notes),
			statusCode: asNumber(args.statusCode),
			preserveQueryParams: asBoolean(args.preserveQueryParams),
			isActive: asBoolean(args.isActive),
		},
	};
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
			const active = args.active;
			return textResult(
				await listLinksForCtx(db, ctx, {
					search: asString(args.search),
					hostname: asString(args.hostname),
					page: asNumber(args.page),
					pageSize: asNumber(args.pageSize),
					active:
						active === "active" || active === "inactive" || active === "all"
							? active
							: "all",
				}),
			);
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
			const id = requiredString(args.id, "id");
			if (!id.ok) {
				return textResult(id.error, true);
			}
			return textResult(await fetchLinkInScope(db, ctx, id.value));
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
			const parsed = parseLinkWriteArgs(args);
			if (!parsed.ok) {
				return textResult(parsed.error, true);
			}
			const id = await createLinkForCtx(db, ctx, parsed.value);
			return textResult(await getLinkById(db, id));
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
			const parsed = parseLinkWriteArgs(args, true);
			if (!parsed.ok) {
				return textResult(parsed.error, true);
			}
			const id = "id" in parsed.value ? parsed.value.id : undefined;
			if (!id) {
				return textResult("id is required", true);
			}
			await updateLinkForCtx(db, ctx, id, parsed.value);
			return textResult(await getLinkById(db, id));
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
			const id = requiredString(args.id, "id");
			if (!id.ok) {
				return textResult(id.error, true);
			}
			return textResult(await deleteLinkForCtx(db, ctx, id.value));
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
		handler: async ({ ctx, db }) =>
			textResult(await listDomainsForCtx(db, ctx)),
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
			const id = requiredString(args.id, "id");
			if (!id.ok) {
				return textResult(id.error, true);
			}
			return textResult(
				await getLinkStatsForCtx(db, ctx, id.value, asNumber(args.days)),
			);
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
