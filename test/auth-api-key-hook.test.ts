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
	const loadOidcProviderTrustedOrigins = vi.fn(
		async (_db: unknown, providerId: string) =>
			providerId === "workforce"
				? ["https://idp.example.test", "https://tokens.example.test"]
				: [],
	);
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
					body?: Record<string, unknown>;
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
		loadOidcProviderTrustedOrigins,
		mcp: vi.fn(() => ({ id: "mcp-plugin" })),
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

vi.mock("better-auth/plugins", () => ({
	mcp: mocks.mcp,
}));

vi.mock("../src/server/auth/onboarding", () => ({
	completePasskeyRegistrationUser: vi.fn(),
	readOnboardingContext: vi.fn(),
	resolvePasskeyRegistrationUser: vi.fn(),
}));

vi.mock("../src/server/services/sso-providers", () => ({
	assertPasskeyAllowed: vi.fn(),
	loadOidcProviderTrustedOrigins: mocks.loadOidcProviderTrustedOrigins,
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
		if (!firstCall) {
			return;
		}
		expect((firstCall[0] as { headers: Headers }).headers.get("cookie")).toBe(
			"better-auth.session_token=session-token",
		);
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

	it("adds persisted OIDC origins for validated initiation and provider callbacks", async () => {
		createAuth(new Request("http://localhost:8787/api/auth/session"));
		const options = mocks.betterAuth.mock.calls.at(-1)?.[0] as {
			trustedOrigins: (request?: Request) => Promise<string[]>;
		};
		const initiationOrigins = await options.trustedOrigins(
			new Request("http://localhost:8787/api/auth/sign-in/sso", {
				body: JSON.stringify({
					callbackURL: "/admin",
					errorCallbackURL: "/api/auth/error",
					issuer: "https://evil.example",
					providerId: "workforce",
					tokenEndpoint: "https://evil.example/token",
				}),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:8787",
				},
				method: "POST",
			}),
		);
		expect(initiationOrigins).toEqual([
			"http://localhost:8787",
			"https://idp.example.test",
			"https://tokens.example.test",
		]);
		expect(initiationOrigins).not.toContain("https://evil.example");

		const callbackOrigins = await options.trustedOrigins(
			new Request(
				"http://localhost:8787/api/auth/sso/callback/workforce?code=code&state=state",
			),
		);
		expect(callbackOrigins).toContain("https://idp.example.test");
	});

	it("does not let provider origins authorize malicious callbacks or request sources", async () => {
		mocks.loadOidcProviderTrustedOrigins.mockClear();
		createAuth(new Request("http://localhost:8787/api/auth/session"));
		const options = mocks.betterAuth.mock.calls.at(-1)?.[0] as {
			hooks: {
				before: (context: {
					body?: Record<string, unknown>;
					path: string;
					request?: Request;
				}) => Promise<unknown>;
			};
			trustedOrigins: (request?: Request) => Promise<string[]>;
		};
		const maliciousCallbackRequest = new Request(
			"http://localhost:8787/api/auth/sign-in/sso",
			{
				body: JSON.stringify({
					callbackURL: "https://idp.example.test/steal",
					providerId: "workforce",
				}),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:8787",
				},
				method: "POST",
			},
		);
		const maliciousSourceRequest = new Request(
			"http://localhost:8787/api/auth/sign-in/sso",
			{
				body: JSON.stringify({
					callbackURL: "/admin",
					providerId: "workforce",
				}),
				headers: {
					"content-type": "application/json",
					origin: "https://idp.example.test",
				},
				method: "POST",
			},
		);
		await expect(
			options.trustedOrigins(maliciousCallbackRequest),
		).resolves.toEqual(["http://localhost:8787"]);
		await expect(
			options.trustedOrigins(maliciousSourceRequest),
		).resolves.toEqual(["http://localhost:8787"]);
		await expect(
			options.hooks.before({
				body: {
					callbackURL: "https://idp.example.test/steal",
					providerId: "workforce",
				},
				path: "/sign-in/sso",
				request: maliciousCallbackRequest,
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		await expect(
			options.hooks.before({
				body: {
					callbackURL: "/admin",
					providerId: "workforce",
				},
				path: "/sign-in/sso",
				request: maliciousSourceRequest,
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		expect(mocks.loadOidcProviderTrustedOrigins).not.toHaveBeenCalled();
	});

	it("fails closed for missing providers and unrelated or SAML callback paths", async () => {
		mocks.loadOidcProviderTrustedOrigins.mockClear();
		createAuth(new Request("http://localhost:8787/api/auth/session"));
		const options = mocks.betterAuth.mock.calls.at(-1)?.[0] as {
			trustedOrigins: (request?: Request) => Promise<string[]>;
		};
		const missingProviderOrigins = await options.trustedOrigins(
			new Request("http://localhost:8787/api/auth/sign-in/sso", {
				body: JSON.stringify({ callbackURL: "/admin" }),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost:8787",
				},
				method: "POST",
			}),
		);
		const unknownProviderOrigins = await options.trustedOrigins(
			new Request(
				"http://localhost:8787/api/auth/sso/callback/missing?code=code",
			),
		);
		const unrelatedOrigins = await options.trustedOrigins(
			new Request("http://localhost:8787/api/auth/session"),
		);
		const samlOrigins = await options.trustedOrigins(
			new Request(
				"http://localhost:8787/api/auth/sso/saml2/sp/acs/workforce?RelayState=https://idp.example.test",
			),
		);
		expect(missingProviderOrigins).toEqual(["http://localhost:8787"]);
		expect(unknownProviderOrigins).toEqual(["http://localhost:8787"]);
		expect(unrelatedOrigins).toEqual(["http://localhost:8787"]);
		expect(samlOrigins).toEqual(["http://localhost:8787"]);
		expect(mocks.loadOidcProviderTrustedOrigins).toHaveBeenCalledTimes(1);
		expect(mocks.loadOidcProviderTrustedOrigins).toHaveBeenCalledWith(
			expect.anything(),
			"missing",
		);
	});

	it("enables IdP-initiated SAML only for an explicitly allowed ACS request", async () => {
		createAuth(new Request("http://localhost:8787/api/auth/session"));
		const defaultOptions = mocks.sso.mock.calls.at(-1)?.[0] as {
			saml?: { allowIdpInitiated?: boolean };
			trustEmailVerified?: boolean;
		};
		expect(defaultOptions.saml?.allowIdpInitiated).toBe(false);
		expect(defaultOptions.trustEmailVerified).toBe(true);

		createAuth(
			new Request("http://localhost:8787/api/auth/sso/saml2/sp/acs/workforce"),
			{ allowSamlIdpInitiated: true },
		);
		const allowedOptions = mocks.sso.mock.calls.at(-1)?.[0] as {
			saml?: { allowIdpInitiated?: boolean };
		};
		expect(allowedOptions.saml?.allowIdpInitiated).toBe(true);
	});

	it("does not treat MCP OAuth bearer tokens as API keys", () => {
		createAuth(new Request("http://localhost/api/auth/session"));
		const lastCall = mocks.apiKey.mock.calls.at(-1) as
			| [
					{
						customAPIKeyGetter?: (ctx: {
							headers?: Headers;
							request?: Request;
						}) => string | null;
					},
			  ]
			| undefined;
		const apiKeyOptions = lastCall?.[0];
		expect(apiKeyOptions).toBeDefined();
		if (!apiKeyOptions) {
			return;
		}
		expect(apiKeyOptions.customAPIKeyGetter).toBeTypeOf("function");
		expect(
			apiKeyOptions.customAPIKeyGetter?.({
				headers: new Headers({
					authorization: "Bearer AbCdEfGhIjKlMnOpQrStUvWxYz012345",
				}),
			}),
		).toBeNull();
		expect(
			apiKeyOptions.customAPIKeyGetter?.({
				headers: new Headers({
					authorization: "Bearer sl_admin_key",
				}),
			}),
		).toBe("sl_admin_key");
	});
});
