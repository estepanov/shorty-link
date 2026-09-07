import { requireMcpAuth } from "@better-auth/mcp";

import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { getLogger, serializeError } from "../logging";
import { authorizeMcpUser } from "./access";
import { mcpOptionsResponse, mcpWwwAuthenticate, withMcpCors } from "./cors";
import { isMcpAuthCorsPath, isMcpHandledPath, isMcpJsonRpcPath } from "./paths";
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

export { isMcpAuthCorsPath };

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

function authorizationResponse(
	status: Exclude<Awaited<ReturnType<typeof authorizeMcpUser>>["status"], "ok">,
	request: Request,
) {
	switch (status) {
		case "disabled":
			return jsonResponse(
				jsonRpcError(
					null,
					JsonRpcErrorCode.unavailable,
					"MCP server is disabled",
				),
				503,
			);
		case "unauth":
			return unauthorizedResponse(request);
		case "denied":
			return jsonResponse(
				jsonRpcError(
					null,
					JsonRpcErrorCode.forbidden,
					"MCP access is disabled for this user",
				),
				403,
			);
		default: {
			const _never: never = status;
			return _never;
		}
	}
}

async function handleJsonRpc(request: Request, userId: string) {
	const db = createDb();
	const access = await authorizeMcpUser(db, userId);
	if (access.status !== "ok") {
		return authorizationResponse(access.status, request);
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
					jsonRpcResult(id, { tools: listMcpTools(access.ctx.permissions) }),
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
				const result = await callMcpTool(params.name, args, access.ctx, db);
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

	if (!isMcpHandledPath(url.pathname)) {
		return null;
	}

	if (request.method === "OPTIONS") {
		return mcpOptionsResponse();
	}

	if (
		url.pathname === "/.well-known/oauth-authorization-server" ||
		url.pathname === "/api/auth/.well-known/oauth-authorization-server" ||
		url.pathname === "/.well-known/oauth-protected-resource" ||
		url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
		url.pathname === "/api/auth/.well-known/oauth-protected-resource"
	) {
		const auth = createAuth(request);
		return withMcpCors(await auth.handler(request));
	}

	if (isMcpJsonRpcPath(url.pathname)) {
		if (request.method !== "POST") {
			return withMcpCors(
				new Response("Method Not Allowed", {
					status: 405,
					headers: { Allow: "POST, OPTIONS" },
				}),
			);
		}
		const auth = createAuth(request);
		const protectedHandler = requireMcpAuth(
			auth,
			(protectedRequest, claims) =>
				handleJsonRpc(
					protectedRequest,
					typeof claims.sub === "string" ? claims.sub : "",
				),
			{ resource: `${requestOrigin(request)}/mcp` },
		);
		return withMcpCors(await protectedHandler(request));
	}

	if (isMcpAuthCorsPath(url.pathname)) {
		return null;
	}

	return null;
}
