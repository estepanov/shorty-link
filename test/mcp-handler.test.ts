import { describe, expect, it } from "vitest";

import { handleMcpRequest } from "../src/server/mcp/handler";

describe("mcp request routing", () => {
	it("does not intercept OPTIONS for non-MCP paths", async () => {
		const response = await handleMcpRequest(
			new Request("http://localhost/api/admin/links", { method: "OPTIONS" }),
		);
		expect(response).toBeNull();
	});

	it("answers OPTIONS for the MCP endpoint", async () => {
		const response = await handleMcpRequest(
			new Request("http://localhost/mcp", { method: "OPTIONS" }),
		);
		expect(response?.status).toBe(204);
		expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});
});
