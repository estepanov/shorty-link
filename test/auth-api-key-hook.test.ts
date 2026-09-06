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
		sso: vi.fn((_options: Record<string, unknown>) => ({
			id: "sso-plugin",
		})),
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

vi.mock("@better-auth/sso", () => ({
	sso: mocks.sso,
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
	readOnboardingContext: vi.fn(),
	resolvePasskeyRegistrationUser: vi.fn(),
}));

vi.mock("../src/server/services/sso-admission", () => ({
	extractIdpGroups: vi.fn(() => []),
}));

vi.mock("../src/server/services/sso-providers", () => ({
	applySsoAdmission: vi.fn(),
	assertPasskeyAllowed: vi.fn(),
	loadSsoSettingsView: vi.fn(),
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

		await createAuth(new Request("http://localhost:8787/api/auth/session"));

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
				request: new Request("http://localhost:8787/api/auth/api-key/create", {
					method: "POST",
				}),
			}),
		).resolves.toBeUndefined();

		expect(mocks.getSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
		});
		const firstCall = mocks.getSession.mock.calls[0];
		expect(firstCall).toBeDefined();
		expect(
			(firstCall?.[0] as { headers: Headers } | undefined)?.headers.get(
				"cookie",
			),
		).toBe("better-auth.session_token=session-token");
	});

	it("rejects Better Auth SSO admin routes unconditionally", async () => {
		createAuth(new Request("http://localhost:8787/api/auth/session"));
		const options = mocks.betterAuth.mock.calls.at(-1)?.[0] as {
			hooks: {
				before: (context: { path: string }) => Promise<unknown>;
			};
		};
		await expect(
			options.hooks.before({ path: "/sso/register" }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		await expect(
			options.hooks.before({ path: "/sso/update-provider" }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		await expect(
			options.hooks.before({ path: "/sso/delete-provider" }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
	});

	it("keeps trustedOrigins limited to Shorty hosts", async () => {
		createAuth(new Request("http://localhost:8787/api/auth/session"));
		const options = mocks.betterAuth.mock.calls.at(-1)?.[0] as {
			trustedOrigins: (request?: Request) => string[];
		};
		const origins = options.trustedOrigins(
			new Request("http://localhost:8787/api/auth/sign-in/sso", {
				body: JSON.stringify({ issuer: "https://evil.example" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(origins).toContain("http://localhost:8787");
		expect(origins).not.toContain("https://evil.example");
	});

	it("enables the plugin capability for gated IdP-initiated SAML", async () => {
		createAuth(new Request("http://localhost:8787/api/auth/session"));
		const pluginOptions = mocks.sso.mock.calls.at(-1)?.[0] as {
			saml?: { allowIdpInitiated?: boolean };
			trustEmailVerified?: boolean;
		};
		expect(pluginOptions.saml?.allowIdpInitiated).toBe(true);
		expect(pluginOptions.trustEmailVerified).toBe(true);
	});
});
