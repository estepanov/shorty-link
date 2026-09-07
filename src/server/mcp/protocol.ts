export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_NAME = "shorty-link";
export const MCP_SERVER_VERSION = "0.2.0";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: unknown;
};

export type JsonRpcSuccess = {
	jsonrpc: "2.0";
	id: JsonRpcId;
	result: unknown;
};

export type JsonRpcFailure = {
	jsonrpc: "2.0";
	id: JsonRpcId;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
};

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export const JsonRpcErrorCode = {
	parseError: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internalError: -32603,
	unauthorized: -32000,
	forbidden: -32001,
	unavailable: -32002,
} as const;

export function jsonRpcError(
	id: JsonRpcId,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcFailure {
	return {
		jsonrpc: "2.0",
		id,
		error: data === undefined ? { code, message } : { code, message, data },
	};
}

export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcSuccess {
	return { jsonrpc: "2.0", id, result };
}

function parseJsonRpcId(value: unknown): JsonRpcId {
	if (value === null || typeof value === "string") {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	throw jsonRpcError(null, JsonRpcErrorCode.invalidRequest, "Invalid Request");
}

export function parseJsonRpcRequest(value: unknown): JsonRpcRequest {
	if (!value || typeof value !== "object") {
		throw jsonRpcError(
			null,
			JsonRpcErrorCode.invalidRequest,
			"Invalid Request",
		);
	}
	const record = value as Record<string, unknown>;
	if (record.jsonrpc !== "2.0" || typeof record.method !== "string") {
		throw jsonRpcError(
			null,
			JsonRpcErrorCode.invalidRequest,
			"Invalid Request",
		);
	}
	return {
		jsonrpc: "2.0",
		id: "id" in record ? parseJsonRpcId(record.id) : undefined,
		method: record.method,
		params: record.params,
	};
}

export function isJsonRpcFailure(value: unknown): value is JsonRpcFailure {
	return (
		typeof value === "object" &&
		value !== null &&
		"error" in value &&
		"jsonrpc" in value
	);
}

export function initializeResult() {
	return {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: {
			tools: { listChanged: false },
		},
		serverInfo: {
			name: MCP_SERVER_NAME,
			version: MCP_SERVER_VERSION,
		},
		instructions:
			"Shorty Link MCP. Tools honor the signed-in user's role, permissions, and domain/link scopes.",
	};
}
