import { describe, expect, it, vi } from "vitest";

import { withSsoConfigCrypto } from "../src/server/auth/sso-adapter";
import {
	decryptSsoConfigJson,
	encryptSsoConfigJson,
	SSO_SECRET_PREFIX,
} from "../src/server/auth/sso-secrets";

const SECRET = "test-better-auth-secret-for-sso";

type FakeAdapter = {
	create: (args: {
		data: Record<string, unknown>;
		model: string;
	}) => Promise<unknown>;
	findMany: (args: { model: string }) => Promise<unknown[]>;
	findOne: (args: { model: string }) => Promise<unknown>;
	update: (args: {
		model: string;
		update: Record<string, unknown>;
	}) => Promise<unknown>;
};

describe("sso adapter crypto", () => {
	it("encrypts configs on write and decrypts them on read", async () => {
		const store: Record<string, unknown>[] = [];
		const adapter = withSsoConfigCrypto<FakeAdapter>(
			{
				async create({ data }) {
					store.push(data);
					return data;
				},
				async findMany() {
					return store;
				},
				async findOne() {
					return store[0] ?? null;
				},
				async update({ update }) {
					store[0] = { ...store[0], ...update };
					return store[0];
				},
			},
			SECRET,
		);

		await adapter.create({
			data: {
				oidcConfig: JSON.stringify({
					clientId: "public-id",
					clientSecret: "super-secret",
				}),
			},
			model: "ssoProvider",
		});

		const stored = store[0]?.oidcConfig;
		expect(typeof stored).toBe("string");
		expect(JSON.parse(String(stored)).clientSecret).toContain(
			SSO_SECRET_PREFIX,
		);

		const loaded = (await adapter.findOne({
			model: "ssoProvider",
		})) as { oidcConfig: string };
		expect(JSON.parse(loaded.oidcConfig).clientSecret).toBe("super-secret");
	});

	it("leaves non-provider models untouched", async () => {
		const create = vi.fn(async (args: unknown) => args);
		const adapter = withSsoConfigCrypto<FakeAdapter>(
			{
				create,
				findMany: async () => [],
				findOne: async () => null,
				update: async (args) => args,
			},
			SECRET,
		);
		await adapter.create({
			data: { oidcConfig: JSON.stringify({ clientSecret: "plain" }) },
			model: "user",
		});
		expect(create).toHaveBeenCalledWith({
			data: { oidcConfig: JSON.stringify({ clientSecret: "plain" }) },
			model: "user",
		});
	});

	it("wraps a Better Auth adapter factory so createAuth can initialize", async () => {
		const factory = (options: { secret: string }) => ({
			create: async (args: {
				data: Record<string, unknown>;
				model: string;
			}) => ({ ...args.data, secret: options.secret }),
			findMany: async () => [],
			findOne: async () => null,
			update: async (args: {
				model: string;
				update: Record<string, unknown>;
			}) => args.update,
		});
		const wrapped = withSsoConfigCrypto(factory, SECRET);
		const adapter = wrapped({ secret: "from-options" });
		const created = (await adapter.create({
			data: {
				oidcConfig: JSON.stringify({ clientSecret: "super-secret" }),
			},
			model: "ssoProvider",
		})) as { oidcConfig: string };
		expect(JSON.parse(created.oidcConfig).clientSecret).toContain(
			SSO_SECRET_PREFIX,
		);
	});

	it("throws when stored secrets cannot be decrypted", async () => {
		const encrypted = await encryptSsoConfigJson(
			JSON.stringify({ clientSecret: "once" }),
			SECRET,
		);
		const adapter = withSsoConfigCrypto<FakeAdapter>(
			{
				create: async (args) => args,
				findMany: async () => [{ oidcConfig: encrypted }],
				findOne: async () => ({ oidcConfig: encrypted }),
				update: async (args) => args,
			},
			"wrong-secret",
		);
		await expect(adapter.findOne({ model: "ssoProvider" })).rejects.toThrow(
			/errors\.ssoSecretDecryptFailed/,
		);
		expect(await decryptSsoConfigJson(encrypted, SECRET)).toContain("once");
	});
});
