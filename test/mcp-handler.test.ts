import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const auth = {
		$context: Promise.resolve({
			baseURL: "",
			internalAdapter: {},
		}),
		handler: vi.fn(async () => new Response(null, { status: 404 })),
	};

	return {
		auth,
		createAuth: vi.fn(() => auth),
		createDpopReplayStore: vi.fn(() => ({
			reserve: vi.fn(async () => true),
		})),
		oauthProviderAuthServerMetadata: vi.fn(
			() => async () =>
				Response.json({
					issuer: "http://localhost/api/auth",
				}),
		),
		oauthProviderOpenIdConfigMetadata: vi.fn(
			() => async () =>
				Response.json({
					issuer: "http://localhost/api/auth",
					userinfo_endpoint: "http://localhost/api/auth/oauth2/userinfo",
				}),
		),
	};
});

vi.mock("@better-auth/oauth-provider", () => ({
	oauthProviderAuthServerMetadata: mocks.oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata: mocks.oauthProviderOpenIdConfigMetadata,
}));

vi.mock("better-auth/oauth2", async () => {
	const actual =
		await vi.importActual<typeof import("better-auth/oauth2")>(
			"better-auth/oauth2",
		);
	return {
		...actual,
		createDpopReplayStore: mocks.createDpopReplayStore,
	};
});

vi.mock("../src/server/auth/auth", () => ({
	createAuth: mocks.createAuth,
}));

const { handleMcpRequest } = await import("../src/server/mcp/handler");

describe("mcp request routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.auth.handler.mockResolvedValue(new Response(null, { status: 404 }));
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

	it.each([
		"/.well-known/oauth-authorization-server/api/auth",
		"/api/auth/.well-known/oauth-authorization-server",
	])("exports authorization server metadata at %s", async (path) => {
		const response = await handleMcpRequest(
			new Request(`http://localhost${path}`),
		);

		expect(response?.status).toBe(200);
		expect(mocks.oauthProviderAuthServerMetadata).toHaveBeenCalledWith(
			mocks.auth,
		);
	});

	it.each([
		"/.well-known/openid-configuration",
		"/.well-known/openid-configuration/api/auth",
		"/api/auth/.well-known/openid-configuration",
	])("exports OpenID configuration at %s", async (path) => {
		const response = await handleMcpRequest(
			new Request(`http://localhost${path}`),
		);

		expect(response?.status).toBe(200);
		expect(mocks.oauthProviderOpenIdConfigMetadata).toHaveBeenCalledWith(
			mocks.auth,
		);
	});

	it("challenges unauthenticated MCP calls without loading JWKS", async () => {
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
		expect(mocks.auth.handler).not.toHaveBeenCalled();
	});

	it("loads JWKS through the in-process auth handler instead of HTTP fetch", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		mocks.auth.handler.mockResolvedValue(Response.json({ keys: [] }));

		const response = await handleMcpRequest(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: {
					Authorization: "Bearer eyJhbGciOiJFZERTQSJ9.e30.e30",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
				}),
			}),
		);

		expect(response?.status).toBe(401);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(mocks.auth.handler).toHaveBeenCalled();
		const jwksUrls = mocks.auth.handler.mock.calls.map(
			([request]) => new URL((request as Request).url).href,
		);
		expect(jwksUrls).toContain("http://localhost/api/auth/jwks");
		fetchSpy.mockRestore();
	});

	it("returns 401 instead of throwing when JWKS cannot be loaded", async () => {
		mocks.auth.handler.mockResolvedValue(new Response("nope", { status: 500 }));

		const response = await handleMcpRequest(
			new Request("http://localhost/mcp", {
				method: "POST",
				headers: {
					Authorization: "Bearer eyJhbGciOiJFZERTQSJ9.e30.e30",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
				}),
			}),
		);

		expect(response?.status).toBe(401);
		expect(response?.headers.get("WWW-Authenticate")).toContain(
			"resource_metadata=",
		);
	});
});
