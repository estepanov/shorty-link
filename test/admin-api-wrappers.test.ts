import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PERMISSIONS } from "../src/lib/permissions";

const mocks = vi.hoisted(() => ({
	getManagedDomainByHostname: vi.fn(),
	createBootstrapContext: vi.fn(),
	createApiKey: vi.fn(),
	createInviteContext: vi.fn(),
	deleteApiKey: vi.fn(),
	getInviteByToken: vi.fn(),
	getSession: vi.fn(),
	handler: vi.fn(),
	listApiKeys: vi.fn(),
	listSessions: vi.fn(),
	loadAuthContext: vi.fn(),
	resolveExactRedirect: vi.fn(),
	resolveRedirect: vi.fn(),
	revokeOtherSessions: vi.fn(),
	revokeSession: vi.fn(),
	updateApiKey: vi.fn(),
}));

vi.mock("../src/server/auth/onboarding", () => ({
	createBootstrapContext: mocks.createBootstrapContext,
	createInviteContext: mocks.createInviteContext,
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

vi.mock("../src/server/services/links", async () => {
	const actual = await vi.importActual("../src/server/services/links");
	return {
		...actual,
		getManagedDomainByHostname: mocks.getManagedDomainByHostname,
		getInviteByToken: mocks.getInviteByToken,
		resolveExactRedirect: mocks.resolveExactRedirect,
		resolveRedirect: mocks.resolveRedirect,
	};
});

vi.mock("../src/server/auth/session", async () => {
	const actual = await vi.importActual<
		typeof import("../src/server/auth/session")
	>("../src/server/auth/session");
	const security = await vi.importActual<
		typeof import("../src/server/auth/security")
	>("../src/server/auth/security");
	const requireAuth = async (request: Request) => {
		const ctx = await mocks.loadAuthContext(request);
		if (!ctx) {
			throw new Response("errors.unauthorized", { status: 401 });
		}
		return ctx;
	};
	const requirePermissionContext = async (request: Request) =>
		requireAuth(request);
	const requireSecurePermission = async (request: Request) => {
		security.assertTrustedAdminWrite(request);
		return requireAuth(request);
	};
	return {
		...actual,
		getSession: mocks.getSession,
		loadAuthContext: mocks.loadAuthContext,
		requireAuth,
		requirePermissionContext,
		requireSecurePermission,
	};
});

vi.mock("../src/server/db/client", () => ({
	createDb: vi.fn(() => ({})),
}));

const { app } = await import("../src/server/api/app");

const FAKE_CTX = {
	user: {
		id: "user-1",
		email: "admin@example.com",
		name: "Admin",
		locale: "en",
		isActive: true,
	},
	role: { id: "system_admin", name: "Admin", isSystem: true },
	permissions: new Set(PERMISSIONS),
	domainScope: null,
	linkScope: null,
};

describe("admin api auth wrappers", () => {
	beforeEach(() => {
		mocks.getManagedDomainByHostname.mockResolvedValue(null);
		mocks.getSession.mockResolvedValue(null);
		mocks.loadAuthContext.mockResolvedValue(FAKE_CTX);
		mocks.resolveExactRedirect.mockResolvedValue(null);
		mocks.resolveRedirect.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns the current admin profile", async () => {
		const response = await app.fetch(
			new Request("https://shorty.test/api/admin/profile"),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			email: "admin@example.com",
			id: "user-1",
			locale: "en",
			name: "Admin",
			roleId: "system_admin",
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

	it("rejects cookie-authenticated admin writes without a same-origin source", async () => {
		const response = await app.fetch(
			new Request("https://shorty.test/api/admin/sessions/revoke-other", {
				headers: {
					cookie: "better-auth.session=abc123",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			code: "AUTH_ERROR",
			message: expect.any(String),
		});
		expect(mocks.revokeOtherSessions).not.toHaveBeenCalled();
	});

	it("allows cookie-authenticated admin writes from the same origin", async () => {
		mocks.revokeOtherSessions.mockResolvedValue({ status: true });

		const response = await app.fetch(
			new Request("https://shorty.test/api/admin/sessions/revoke-other", {
				headers: {
					cookie: "better-auth.session=abc123",
					origin: "https://shorty.test",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
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

	it("redirects the managed domain root when that policy is enabled", async () => {
		mocks.getManagedDomainByHostname.mockResolvedValue({
			rootBehavior: "redirect",
			rootRedirectStatusCode: 308,
			rootRedirectTargetUrl: "brand.example.com/home",
		});

		const response = await app.fetch(new Request("https://brand.example.com/"));

		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(
			"https://brand.example.com/home",
		);
		expect(mocks.resolveRedirect).not.toHaveBeenCalled();
	});

	it("uses the managed domain unknown-slug redirect without default-host fallback", async () => {
		mocks.getManagedDomainByHostname.mockResolvedValue({
			rootBehavior: "landing",
			rootRedirectStatusCode: null,
			rootRedirectTargetUrl: null,
			unknownSlugBehavior: "redirect",
			unknownSlugRedirectStatusCode: 302,
			unknownSlugRedirectTargetUrl: "https://brand.example.com/help",
		});
		mocks.resolveRedirect.mockResolvedValue({
			id: "default-link",
			targetUrl: "https://example.com/default",
		});

		const response = await app.fetch(
			new Request("https://brand.example.com/does-not-exist"),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://brand.example.com/help",
		);
		expect(mocks.resolveExactRedirect).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				hostname: "brand.example.com",
				slug: "does-not-exist",
			}),
		);
		expect(mocks.resolveRedirect).not.toHaveBeenCalled();
	});

	it("returns the default 404 for managed domains without an unknown-slug redirect", async () => {
		mocks.getManagedDomainByHostname.mockResolvedValue({
			rootBehavior: "landing",
			rootRedirectStatusCode: null,
			rootRedirectTargetUrl: null,
			unknownSlugBehavior: "not_found",
			unknownSlugRedirectStatusCode: null,
			unknownSlugRedirectTargetUrl: null,
		});

		const response = await app.fetch(
			new Request("https://brand.example.com/does-not-exist"),
		);

		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe("Short link not found");
		expect(mocks.resolveRedirect).not.toHaveBeenCalled();
	});

	it("rejects invite routes when a session is already active", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "user-1" },
		});

		const inviteResponse = await app.fetch(
			new Request("https://shorty.test/api/invites/invite-token-value"),
		);
		expect(inviteResponse.status).toBe(403);
		await expect(inviteResponse.json()).resolves.toMatchObject({
			code: "AUTH_ERROR",
			message: "Sign out before opening an invite link.",
		});
		expect(mocks.getInviteByToken).not.toHaveBeenCalled();

		const onboardingResponse = await app.fetch(
			new Request("https://shorty.test/api/onboarding/invite", {
				body: JSON.stringify({
					locale: "en",
					name: "Invited Admin",
					token: "invite-token-value",
				}),
				headers: {
					"content-type": "application/json",
					origin: "https://shorty.test",
				},
				method: "POST",
			}),
		);
		expect(onboardingResponse.status).toBe(403);
		await expect(onboardingResponse.json()).resolves.toMatchObject({
			code: "AUTH_ERROR",
			message: "Sign out before opening an invite link.",
		});
		expect(mocks.createInviteContext).not.toHaveBeenCalled();
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
				body: JSON.stringify({
					enabled: false,
					expiresInDays: 7,
					name: "Renamed",
				}),
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
