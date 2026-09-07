import { describe, expect, it } from "vitest";

import {
	initializeResult,
	JsonRpcErrorCode,
	jsonRpcError,
	parseJsonRpcRequest,
} from "../src/server/mcp/protocol";
import { listMcpTools } from "../src/server/mcp/tools";

describe("mcp protocol", () => {
	it("parses a valid json-rpc request", () => {
		expect(
			parseJsonRpcRequest({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
			}),
		).toEqual({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: undefined,
		});
	});

	it("rejects invalid json-rpc ids", () => {
		expect(() =>
			parseJsonRpcRequest({
				jsonrpc: "2.0",
				id: { spoofed: true },
				method: "initialize",
			}),
		).toThrow();
	});

	it("rejects invalid json-rpc payloads", () => {
		expect(() => parseJsonRpcRequest({ method: "initialize" })).toThrow();
		try {
			parseJsonRpcRequest({ method: "initialize" });
		} catch (error) {
			expect(error).toMatchObject({
				error: { code: JsonRpcErrorCode.invalidRequest },
			});
		}
	});

	it("returns initialize metadata for hosted clients", () => {
		const result = initializeResult();
		expect(result.protocolVersion).toBe("2025-03-26");
		expect(result.capabilities.tools).toEqual({ listChanged: false });
		expect(result.serverInfo.name).toBe("shorty-link");
	});

	it("advertises only tools the user can use", () => {
		const names = listMcpTools(new Set(["links.read"])).map(
			(tool) => tool.name,
		);
		expect(names).toContain("whoami");
		expect(names).toContain("list_links");
		expect(names).toContain("get_link");
		expect(names).not.toContain("create_link");
		expect(names).not.toContain("delete_link");
		expect(names).not.toContain("get_link_stats");
	});

	it("builds a standard json-rpc error", () => {
		expect(jsonRpcError(7, JsonRpcErrorCode.unauthorized, "nope")).toEqual({
			jsonrpc: "2.0",
			id: 7,
			error: { code: JsonRpcErrorCode.unauthorized, message: "nope" },
		});
	});
});
