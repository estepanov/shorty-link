import type {
	DBAdapter,
	DBAdapterInstance,
} from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "better-auth";
import { describe, expect, it } from "vitest";

import { withSsoConfigCrypto } from "../src/server/auth/sso-adapter";
import {
	decryptSsoConfigJson,
	encryptSsoConfigJson,
	SSO_SECRET_PREFIX,
} from "../src/server/auth/sso-secrets";

const SECRET = "test-better-auth-secret-for-sso";

function createMemoryAdapterFactory(store: Record<string, unknown>[]) {
	const factory: DBAdapterInstance = () => {
		const adapter: DBAdapter = {
			id: "sso-crypto-test",
			async count() {
				return store.length;
			},
			async create<T extends Record<string, unknown>, R = T>({
				data,
			}: {
				data: Omit<T, "id">;
			}) {
				const row = { ...data };
				store.push(row);
				return row as R;
			},
			async delete() {},
			async deleteMany() {
				return 0;
			},
			async findMany<T>() {
				return store as T[];
			},
			async findOne<T>() {
				return (store[0] as T | undefined) ?? null;
			},
			async update<T>({ update }: { update: Record<string, unknown> }) {
				store[0] = { ...store[0], ...update };
				return store[0] as T;
			},
			async updateMany({ update }) {
				for (const [index, row] of store.entries()) {
					store[index] = { ...row, ...update };
				}
				return store.length;
			},
			async consumeOne<T>() {
				return (store.shift() as T | undefined) ?? null;
			},
			async incrementOne<T>({ set }: { set?: Record<string, unknown> }) {
				store[0] = { ...store[0], ...set };
				return (store[0] as T | undefined) ?? null;
			},
			async transaction<R>(callback: (trx: DBAdapter) => Promise<R>) {
				return callback(adapter);
			},
		};
		return adapter;
	};
	return factory;
}

function createAdapter(store: Record<string, unknown>[], secret = SECRET) {
	const factory = createMemoryAdapterFactory(store);
	const options = { database: factory } satisfies BetterAuthOptions;
	return withSsoConfigCrypto(factory, secret)(options);
}

describe("sso adapter crypto", () => {
	it("encrypts configs on write and decrypts them on read", async () => {
		const store: Record<string, unknown>[] = [];
		const adapter = createAdapter(store);

		const created = await adapter.create<{ oidcConfig: string }>({
			data: {
				oidcConfig: JSON.stringify({
					clientId: "public-id",
					clientSecret: "super-secret",
				}),
			},
			model: "ssoProvider",
		});

		expect(JSON.parse(created.oidcConfig).clientSecret).toBe("super-secret");
		expect(JSON.parse(String(store[0]?.oidcConfig)).clientSecret).toContain(
			SSO_SECRET_PREFIX,
		);
		const loaded = await adapter.findOne<{ oidcConfig: string }>({
			model: "ssoProvider",
			where: [],
		});
		expect(JSON.parse(loaded?.oidcConfig ?? "{}").clientSecret).toBe(
			"super-secret",
		);
	});

	it("leaves non-provider models untouched and delegates full capabilities", async () => {
		const store: Record<string, unknown>[] = [];
		const adapter = createAdapter(store);
		const plain = JSON.stringify({ clientSecret: "plain" });

		await adapter.create({
			data: { oidcConfig: plain },
			model: "user",
		});

		expect(store[0]?.oidcConfig).toBe(plain);
		expect(await adapter.count({ model: "user" })).toBe(1);
		expect(adapter.id).toBe("sso-crypto-test");
	});

	it("throws when stored secrets cannot be decrypted", async () => {
		const encrypted = await encryptSsoConfigJson(
			JSON.stringify({ clientSecret: "once" }),
			SECRET,
		);
		const adapter = createAdapter([{ oidcConfig: encrypted }], "wrong-secret");

		await expect(
			adapter.findOne({ model: "ssoProvider", where: [] }),
		).rejects.toThrow(/errors\.ssoSecretDecryptFailed/);
		expect(await decryptSsoConfigJson(encrypted, SECRET)).toContain("once");
	});

	it("preserves the crypto boundary for bulk, row-returning, and transaction methods", async () => {
		const store: Record<string, unknown>[] = [];
		const adapter = createAdapter(store);
		const oidcConfig = JSON.stringify({ clientSecret: "transaction-secret" });
		const samlConfig = JSON.stringify({ privateKey: "transaction-key" });

		await adapter.transaction(async (transaction) => {
			await transaction.create({
				data: { oidcConfig },
				model: "ssoProvider",
			});
			expect(String(store[0]?.oidcConfig)).toContain(SSO_SECRET_PREFIX);

			const updated = await transaction.update<{ samlConfig: string }>({
				model: "ssoProvider",
				update: { samlConfig },
				where: [],
			});
			expect(JSON.parse(updated?.samlConfig ?? "{}").privateKey).toBe(
				"transaction-key",
			);
			expect(String(store[0]?.samlConfig)).toContain(SSO_SECRET_PREFIX);

			await transaction.updateMany({
				model: "ssoProvider",
				update: { oidcConfig },
				where: [],
			});
			expect(String(store[0]?.oidcConfig)).toContain(SSO_SECRET_PREFIX);

			const incremented = await transaction.incrementOne<{
				samlConfig: string;
			}>({
				increment: {},
				model: "ssoProvider",
				set: { samlConfig },
				where: [],
			});
			expect(JSON.parse(incremented?.samlConfig ?? "{}").privateKey).toBe(
				"transaction-key",
			);

			const consumed = await transaction.consumeOne<{
				oidcConfig: string;
				samlConfig: string;
			}>({
				model: "ssoProvider",
				where: [],
			});
			expect(JSON.parse(consumed?.oidcConfig ?? "{}").clientSecret).toBe(
				"transaction-secret",
			);
			expect(JSON.parse(consumed?.samlConfig ?? "{}").privateKey).toBe(
				"transaction-key",
			);
		});

		expect(store).toHaveLength(0);
	});
});
