import {
	oAuthDiscoveryMetadata,
	oAuthProtectedResourceMetadata,
} from "better-auth/plugins";

import { createAuth } from "../auth/auth";
import { loadAuthContextForUser } from "../auth/session";
import { createDb } from "../db/client";
import { getLogger, serializeError } from "../logging";
import {
	assertMcpServerEnabled,
	assertMcpUserAllowed,
} from "../services/mcp-settings";
import { mcpOptionsResponse, mcpWwwAuthenticate, withMcpCors } from "./cors";
import { getMcpBearerSession } from "./session";
import {
	initializeResult,
	isJsonRpcFailure,
	JsonRpcErrorCode,
	type JsonRpcId,
	jsonRpcError,
	jsonRpcResult,
	parseJsonRpcRequest,
} from "./protocol";
import { callMcpTool, listMcpTools } from "./tools";

const log = getLogger(["mcp"]);

function requestOrigin(request: Request) {
	return new URL(request.url).origin;
}

function jsonResponse(
	body: unknown,
	status: number,
	extraHeaders?: HeadersInit,
) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...extraHeaders,
		},
	});
}

function unauthorizedResponse(request: Request, id: JsonRpcId = null) {
	const challenge = mcpWwwAuthenticate(requestOrigin(request));
	return jsonResponse(
		jsonRpcError(
			id,
			JsonRpcErrorCode.unauthorized,
			"Unauthorized: Authentication required",
			{ "www-authenticate": challenge },
		),
		401,
		{ "WWW-Authenticate": challenge },
	);
}

function isMcpOAuthPath(pathname: string) {
	return (
		pathname.startsWith("/api/auth/mcp/") ||
		pathname.startsWith("/api/auth/.well-known/")
	);
}

export function isMcpPublicPath(pathname: string) {
	return (
		pathname === "/mcp" ||
		pathname.startsWith("/mcp/") ||
		pathname === "/.well-known/oauth-authorization-server" ||
		pathname === "/.well-known/oauth-protected-resource" ||
		pathname.startsWith("/.well-known/oauth-protected-resource/") ||
		isMcpOAuthPath(pathname)
	);
}

async function handleJsonRpc(request: Request) {
	const db = createDb();
	try {
		await assertMcpServerEnabled(db);
	} catch {
		return jsonResponse(
			jsonRpcError(
				null,
				JsonRpcErrorCode.unavailable,
				"MCP server is disabled",
			),
			503,
		);
	}

	const session = await getMcpBearerSession(db, request);
	if (!session?.userId) {
		return unauthorizedResponse(request);
	}

	try {
		await assertMcpUserAllowed(db, session.userId);
	} catch {
		return jsonResponse(
			jsonRpcError(
				null,
				JsonRpcErrorCode.forbidden,
				"MCP access is disabled for this user",
			),
			403,
		);
	}

	const ctx = await loadAuthContextForUser(session.userId);
	if (!ctx) {
		return jsonResponse(
			jsonRpcError(
				null,
				JsonRpcErrorCode.forbidden,
				"MCP access is disabled for this user",
			),
			403,
		);
	}

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return jsonResponse(
			jsonRpcError(null, JsonRpcErrorCode.parseError, "Parse error"),
			400,
		);
	}

	let rpc: ReturnType<typeof parseJsonRpcRequest>;
	try {
		rpc = parseJsonRpcRequest(payload);
	} catch (error) {
		if (isJsonRpcFailure(error)) {
			return jsonResponse(error, 400);
		}
		return jsonResponse(
			jsonRpcError(null, JsonRpcErrorCode.invalidRequest, "Invalid Request"),
			400,
		);
	}

	const id = rpc.id ?? null;
	if (rpc.id === undefined) {
		return new Response(null, { status: 202 });
	}

	try {
		switch (rpc.method) {
			case "initialize":
				return jsonResponse(jsonRpcResult(id, initializeResult()), 200);
			case "ping":
				return jsonResponse(jsonRpcResult(id, {}), 200);
			case "tools/list":
				return jsonResponse(
					jsonRpcResult(id, { tools: listMcpTools(ctx.permissions) }),
					200,
				);
			case "tools/call": {
				const params =
					rpc.params && typeof rpc.params === "object"
						? (rpc.params as { name?: unknown; arguments?: unknown })
						: {};
				if (typeof params.name !== "string") {
					return jsonResponse(
						jsonRpcError(
							id,
							JsonRpcErrorCode.invalidParams,
							"tools/call requires name",
						),
						400,
					);
				}
				const args =
					params.arguments && typeof params.arguments === "object"
						? (params.arguments as Record<string, unknown>)
						: {};
				const result = await callMcpTool(params.name, args, ctx, db);
				return jsonResponse(jsonRpcResult(id, result), 200);
			}
			case "resources/list":
				return jsonResponse(jsonRpcResult(id, { resources: [] }), 200);
			case "prompts/list":
				return jsonResponse(jsonRpcResult(id, { prompts: [] }), 200);
			default:
				return jsonResponse(
					jsonRpcError(
						id,
						JsonRpcErrorCode.methodNotFound,
						`Method not found: ${rpc.method}`,
					),
					404,
				);
		}
	} catch (error) {
		log.error("mcp json-rpc failed", { error: serializeError(error) });
		return jsonResponse(
			jsonRpcError(id, JsonRpcErrorCode.internalError, "Internal error"),
			500,
		);
	}
}

export async function handleMcpRequest(request: Request) {
	const url = new URL(request.url);

	if (request.method === "OPTIONS") {
		return mcpOptionsResponse();
	}

	if (
		url.pathname === "/.well-known/oauth-authorization-server" ||
		url.pathname === "/api/auth/.well-known/oauth-authorization-server"
	) {
		const auth = createAuth(request);
		return withMcpCors(await oAuthDiscoveryMetadata(auth)(request));
	}

	if (
		url.pathname === "/.well-known/oauth-protected-resource" ||
		url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
		url.pathname === "/api/auth/.well-known/oauth-protected-resource"
	) {
		const auth = createAuth(request);
		return withMcpCors(await oAuthProtectedResourceMetadata(auth)(request));
	}

	if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
		if (request.method !== "POST") {
			return withMcpCors(
				new Response("Method Not Allowed", {
					status: 405,
					headers: { Allow: "POST, OPTIONS" },
				}),
			);
		}
		return withMcpCors(await handleJsonRpc(request));
	}

	if (isMcpOAuthPath(url.pathname) && request.method === "OPTIONS") {
		return mcpOptionsResponse();
	}

	return null;
}
