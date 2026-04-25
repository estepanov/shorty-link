import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	class MockApiError extends Error {
		status: string;

		constructor(status: string, options?: { message?: string }) {
			super(options?.message ?? status);
			this.name = "APIError";
			this.status = status;
		}
	}

	const getSession = vi.fn();
	const betterAuth = vi.fn((options: Record<string, unknown>) => ({
		api: {
			getSession,
		},
		handler: vi.fn(),
		options,
	}));
	const createDb = vi.fn(() => ({
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([
							{
								isActive: true,
								permissions: JSON.stringify(["apikeys.manage"]),
							},
						]),
					})),
				})),
			})),
		})),
	}));

	return {
		APIError: MockApiError,
		apiKey: vi.fn(() => ({ id: "api-key-plugin" })),
		betterAuth,
		createAuthMiddleware: vi.fn(
			(
				handler: (context: {
					context?: Record<string, unknown>;
					headers?: HeadersInit;
					path: string;
					request?: Request;
				}) => Promise<unknown>,
			) => handler,
		),
		createDb,
		getSession,
		i18n: vi.fn(() => ({ id: "i18n-plugin" })),
		passkey: vi.fn(() => ({ id: "passkey-plugin" })),
		tanstackStartCookies: vi.fn(() => ({ id: "tanstack-start-cookies" })),
	};
});

vi.mock("@better-auth/api-key", () => ({
	apiKey: mocks.apiKey,
}));

vi.mock("@better-auth/drizzle-adapter", () => ({
	drizzleAdapter: vi.fn(() => ({})),
}));

vi.mock("@better-auth/i18n", () => ({
	i18n: mocks.i18n,
}));

vi.mock("@better-auth/passkey", () => ({
	passkey: mocks.passkey,
}));

vi.mock("better-auth", () => ({
	betterAuth: mocks.betterAuth,
}));

vi.mock("better-auth/api", () => ({
	APIError: mocks.APIError,
	createAuthMiddleware: mocks.createAuthMiddleware,
}));

vi.mock("better-auth/tanstack-start", () => ({
	tanstackStartCookies: mocks.tanstackStartCookies,
}));

vi.mock("../src/server/auth/onboarding", () => ({
	completePasskeyRegistrationUser: vi.fn(),
	resolvePasskeyRegistrationUser: vi.fn(),
}));

vi.mock("../src/server/auth/secret", () => ({
	getAuthSecret: vi.fn(() => "test-secret"),
}));

vi.mock("../src/server/db/client", () => ({
	createDb: mocks.createDb,
}));

const { createAuth } = await import("../src/server/auth/auth");

describe("api key auth hook", () => {
	it("uses forwarded hook headers to resolve the current session", async () => {
		mocks.getSession.mockImplementation(
			async ({ headers }: { headers: Headers }) =>
				headers
					.get("cookie")
					?.includes("better-auth.session_token=session-token")
					? { user: { id: "owner-1" } }
					: null,
		);

		createAuth(new Request("http://localhost:3000/api/auth/session"));

		const options = mocks.betterAuth.mock.calls[0]?.[0] as {
			hooks: {
				before: (context: {
					context?: Record<string, unknown>;
					headers?: HeadersInit;
					path: string;
					request?: Request;
				}) => Promise<unknown>;
			};
		};

		await expect(
			options.hooks.before({
				headers: new Headers({
					cookie: "better-auth.session_token=session-token",
				}),
				path: "/api-key/create",
				request: new Request("http://localhost:3000/api/auth/api-key/create", {
					method: "POST",
				}),
			}),
		).resolves.toBeUndefined();

		expect(mocks.getSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
		});
		expect(
			(mocks.getSession.mock.calls[0]?.[0] as { headers: Headers }).headers.get(
				"cookie",
			),
		).toBe("better-auth.session_token=session-token");
	});
});
