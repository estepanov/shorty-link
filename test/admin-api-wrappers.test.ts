import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createApiKey: vi.fn(),
	deleteApiKey: vi.fn(),
	handler: vi.fn(),
	listApiKeys: vi.fn(),
	listSessions: vi.fn(),
	requireAdmin: vi.fn(),
	revokeOtherSessions: vi.fn(),
	revokeSession: vi.fn(),
	updateApiKey: vi.fn(),
}));

vi.mock("../src/server/auth/auth", () => ({
	createAuth: vi.fn(() => ({
		api: {
			createApiKey: mocks.createApiKey,
			deleteApiKey: mocks.deleteApiKey,
			listApiKeys: mocks.listApiKeys,
			listSessions: mocks.listSessions,
			revokeOtherSessions: mocks.revokeOtherSessions,
			revokeSession: mocks.revokeSession,
			updateApiKey: mocks.updateApiKey,
		},
		handler: mocks.handler,
	})),
}));

vi.mock("../src/server/auth/session", () => ({
	requireAdmin: mocks.requireAdmin,
}));

vi.mock("../src/server/db/client", () => ({
	createDb: vi.fn(() => ({})),
}));

const { app } = await import("../src/server/api/app");

describe("admin api auth wrappers", () => {
	beforeEach(() => {
		mocks.requireAdmin.mockResolvedValue({
			user: {
				email: "admin@example.com",
				id: "user-1",
				locale: "en",
				name: "Admin",
			},
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns the current admin profile", async () => {
		const response = await app.fetch(
			new Request("https://shorty.test/api/admin/profile"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			email: "admin@example.com",
			id: "user-1",
			locale: "en",
			name: "Admin",
		});
	});

	it("delegates session list and revoke routes to Better Auth", async () => {
		mocks.listSessions.mockResolvedValue([
			{
				expiresAt: new Date("2026-04-30T00:00:00Z"),
				ipAddress: "127.0.0.1",
				token: "session-token",
				userAgent: "Vitest",
			},
		]);
		mocks.revokeSession.mockResolvedValue({ status: true });
		mocks.revokeOtherSessions.mockResolvedValue({ status: true });

		const listResponse = await app.fetch(
			new Request("https://shorty.test/api/admin/sessions"),
		);
		expect(listResponse.status).toBe(200);
		await expect(listResponse.json()).resolves.toHaveLength(1);
		expect(mocks.listSessions).toHaveBeenCalledWith({
			headers: expect.any(Headers),
		});

		const revokeResponse = await app.fetch(
			new Request("https://shorty.test/api/admin/sessions/revoke", {
				body: JSON.stringify({ token: "session-token" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(revokeResponse.status).toBe(200);
		expect(mocks.revokeSession).toHaveBeenCalledWith({
			body: { token: "session-token" },
			headers: expect.any(Headers),
		});

		const revokeOtherResponse = await app.fetch(
			new Request("https://shorty.test/api/admin/sessions/revoke-other", {
				method: "POST",
			}),
		);
		expect(revokeOtherResponse.status).toBe(200);
		expect(mocks.revokeOtherSessions).toHaveBeenCalledWith({
			headers: expect.any(Headers),
		});
	});

	it("passes sign-out through the Better Auth handler", async () => {
		mocks.handler.mockResolvedValue(
			new Response(JSON.stringify({ success: true }), {
				headers: {
					"content-type": "application/json",
					"set-cookie": "session=; Max-Age=0; Path=/",
				},
				status: 200,
			}),
		);

		const response = await app.fetch(
			new Request("https://shorty.test/api/admin/sessions/current", {
				method: "DELETE",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(mocks.handler).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "POST",
				url: "https://shorty.test/api/auth/sign-out",
			}),
		);
	});

	it("maps api key list and create requests to Better Auth", async () => {
		mocks.listApiKeys.mockResolvedValue({
			apiKeys: [{ id: "key-1", name: "Primary" }],
		});
		mocks.createApiKey.mockResolvedValue({
			id: "key-1",
			key: "sl_secret",
			name: "Primary",
		});

		const listResponse = await app.fetch(
			new Request(
				"https://shorty.test/api/admin/api-keys?limit=25&sortBy=createdAt&sortDirection=desc",
			),
		);
		expect(listResponse.status).toBe(200);
		expect(mocks.listApiKeys).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: {
				limit: 25,
				offset: undefined,
				sortBy: "createdAt",
				sortDirection: "desc",
			},
		});

		const createResponse = await app.fetch(
			new Request("https://shorty.test/api/admin/api-keys", {
				body: JSON.stringify({ expiresInDays: 30, name: "Primary" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(createResponse.status).toBe(200);
		expect(mocks.createApiKey).toHaveBeenCalledWith({
			body: {
				expiresIn: 30 * 24 * 60 * 60,
				name: "Primary",
			},
			headers: expect.any(Headers),
		});
	});

	it("maps api key update and delete requests to Better Auth", async () => {
		mocks.updateApiKey.mockResolvedValue({ id: "key-1", name: "Renamed" });
		mocks.deleteApiKey.mockResolvedValue({ success: true });

		const updateResponse = await app.fetch(
			new Request("https://shorty.test/api/admin/api-keys/key-1", {
				body: JSON.stringify({ enabled: false, expiresInDays: 7, name: "Renamed" }),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(updateResponse.status).toBe(200);
		expect(mocks.updateApiKey).toHaveBeenCalledWith({
			body: {
				enabled: false,
				expiresIn: 7 * 24 * 60 * 60,
				keyId: "key-1",
				name: "Renamed",
			},
			headers: expect.any(Headers),
		});

		const deleteResponse = await app.fetch(
			new Request("https://shorty.test/api/admin/api-keys/key-1", {
				method: "DELETE",
			}),
		);
		expect(deleteResponse.status).toBe(200);
		expect(mocks.deleteApiKey).toHaveBeenCalledWith({
			body: { keyId: "key-1" },
			headers: expect.any(Headers),
		});
	});
});
