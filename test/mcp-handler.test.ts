import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const auth = {
		$context: Promise.resolve({
			baseURL: "",
			internalAdapter: {},
		}),
		handler: vi.fn(async () => new Response(null, { status: 404 })),
	};
	const replayStore = { reserve: vi.fn(async () => true) };
	const unauthorizedHandler = () => async () =>
		new Response(
			JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32000, message: "missing authorization header" },
				id: null,
			}),
			{
				status: 401,
				headers: {
					"WWW-Authenticate":
						'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
				},
			},
		);

	return {
		auth,
		createAuth: vi.fn(() => auth),
		createDpopReplayStore: vi.fn(() => replayStore),
		createMcpProtectedRequestHandler: vi.fn(unauthorizedHandler),
		oauthProviderAuthServerMetadata: vi.fn(
			() => async () =>
				Response.json({
					issuer: "http://localhost/api/auth",
				}),
		),
		replayStore,
	};
});

vi.mock("@better-auth/mcp", () => ({
	createMcpProtectedRequestHandler: mocks.createMcpProtectedRequestHandler,
}));

vi.mock("@better-auth/oauth-provider", () => ({
	oauthProviderAuthServerMetadata: mocks.oauthProviderAuthServerMetadata,
}));

vi.mock("better-auth/oauth2", () => ({
	createDpopReplayStore: mocks.createDpopReplayStore,
}));

vi.mock("../src/server/auth/auth", () => ({
	createAuth: mocks.createAuth,
}));

const { handleMcpRequest } = await import("../src/server/mcp/handler");

describe("mcp request routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

	it("exports authorization server metadata at the root well-known path", async () => {
		const response = await handleMcpRequest(
			new Request("http://localhost/.well-known/oauth-authorization-server"),
		);

		expect(response?.status).toBe(200);
		expect(mocks.oauthProviderAuthServerMetadata).toHaveBeenCalledWith(
			mocks.auth,
		);
		expect(mocks.auth.handler).not.toHaveBeenCalled();
	});

	it("protects MCP with request-derived issuer and JWKS URLs", async () => {
		const response = await handleMcpRequest(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
				}),
			}),
		);

		expect(response?.status).toBe(401);
		expect(response?.headers.get("WWW-Authenticate")).toContain(
			'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
		);
		expect(mocks.createDpopReplayStore).toHaveBeenCalledWith(
			(await mocks.auth.$context).internalAdapter,
		);
		expect(mocks.createMcpProtectedRequestHandler).toHaveBeenCalledWith(
			{
				audience: "http://localhost/mcp",
				dpop: { replayStore: mocks.replayStore },
				issuer: "http://localhost/api/auth",
				jwksUrl: "http://localhost/api/auth/jwks",
			},
			expect.any(Function),
		);
	});
});
