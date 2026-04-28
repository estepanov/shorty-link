import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createSession: vi.fn(),
}));

vi.mock("../src/server/auth/auth", () => ({
	createAuth: vi.fn(() => ({
		$context: Promise.resolve({
			authCookies: {
				sessionToken: {
					attributes: {
						httpOnly: true,
						path: "/",
						sameSite: "lax",
						secure: false,
					},
					name: "better-auth.session_token",
				},
			},
			internalAdapter: {
				createSession: mocks.createSession,
			},
			secret: "agent-test-secret",
			sessionConfig: {
				expiresIn: 604_800,
			},
		}),
	})),
}));

const { createAgentLoginResponse } = await import(
	"../src/server/auth/agent-login"
);

function createDbMock(options: { existingUserId?: string } = {}) {
	const limit = vi.fn(async () =>
		options.existingUserId ? [{ id: options.existingUserId }] : [],
	);
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	const updateWhere = vi.fn(async () => undefined);
	const set = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set }));
	const values = vi.fn(async () => undefined);
	const insert = vi.fn(() => ({ values }));

	return {
		db: { insert, select, update },
		insert,
		limit,
		select,
		set,
		update,
		values,
		where,
	};
}

describe("agent browser login", () => {
	beforeEach(() => {
		mocks.createSession.mockResolvedValue({
			id: "session-1",
			token: "session-token",
		});
	});

	it("stays hidden unless explicitly enabled", async () => {
		const { db } = createDbMock();
		const response = await createAgentLoginResponse({
			db: db as never,
			env: {},
			request: new Request("http://localhost:8787/api/dev/agent-login"),
		});

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("rejects bad secrets and non-local hosts", async () => {
		const { db } = createDbMock();
		const env = {
			AGENT_BROWSER_AUTH_ENABLED: "true",
			AGENT_BROWSER_AUTH_SECRET: "agent-secret",
		};

		const badSecret = await createAgentLoginResponse({
			db: db as never,
			env,
			request: new Request(
				"http://localhost:8787/api/dev/agent-login?secret=wrong",
			),
		});
		expect(badSecret.status).toBe(403);

		const remoteHost = await createAgentLoginResponse({
			db: db as never,
			env,
			request: new Request("https://short.example.com/api/dev/agent-login", {
				headers: { "x-agent-auth-secret": "agent-secret" },
			}),
		});
		expect(remoteHost.status).toBe(404);
	});

	it("creates an agent owner session cookie for local browser automation", async () => {
		const dbMock = createDbMock();
		const response = await createAgentLoginResponse({
			db: dbMock.db as never,
			env: {
				AGENT_BROWSER_AUTH_ENABLED: "true",
				AGENT_BROWSER_AUTH_SECRET: "agent-secret",
			},
			request: new Request(
				"http://localhost:8787/api/dev/agent-login?secret=agent-secret&email=agent@example.test&name=Agent%20User",
				{ headers: { accept: "application/json", "user-agent": "Vitest" } },
			),
		});

		expect(response.status).toBe(200);
		expect(dbMock.values).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "agent@example.test",
				isActive: true,
				name: "Agent User",
				roleId: "system_owner",
			}),
		);
		expect(mocks.createSession).toHaveBeenCalledWith(
			expect.any(String),
			false,
			expect.objectContaining({ userAgent: "Vitest" }),
		);
		const setCookie = response.headers.get("set-cookie") ?? "";
		expect(setCookie).toContain("better-auth.session_token=");
		expect(decodeURIComponent(setCookie)).toContain("session-token.");
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("SameSite=Lax");
	});

	it("reactivates an existing local agent user instead of inserting", async () => {
		const dbMock = createDbMock({ existingUserId: "existing-agent" });
		const response = await createAgentLoginResponse({
			db: dbMock.db as never,
			env: {
				AGENT_BROWSER_AUTH_ENABLED: "true",
				AGENT_BROWSER_AUTH_SECRET: "agent-secret",
			},
			request: new Request(
				"http://localhost:8787/api/dev/agent-login?secret=agent-secret",
				{ headers: { accept: "application/json" } },
			),
		});

		expect(response.status).toBe(200);
		expect(dbMock.update).toHaveBeenCalled();
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(mocks.createSession).toHaveBeenCalledWith(
			"existing-agent",
			false,
			expect.any(Object),
		);
	});
});
