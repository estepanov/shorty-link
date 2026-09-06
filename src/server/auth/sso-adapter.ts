import type {
	DBAdapter,
	DBAdapterInstance,
	DBTransactionAdapter,
} from "@better-auth/core/db/adapter";

import { decryptSsoConfigJson, encryptSsoConfigJson } from "./sso-secrets";

async function mapConfigField(
	value: unknown,
	transform: (json: string) => Promise<string>,
) {
	if (typeof value !== "string" || !value) {
		return value;
	}
	return transform(value);
}

async function mapSsoConfigs<T>(
	row: T,
	transform: (json: string) => Promise<string>,
): Promise<T> {
	if (!row || typeof row !== "object") {
		return row;
	}
	const record = row as Record<string, unknown>;
	if (!("oidcConfig" in record) && !("samlConfig" in record)) {
		return row;
	}
	const mapped = { ...record };
	if ("oidcConfig" in record) {
		mapped.oidcConfig = await mapConfigField(record.oidcConfig, transform);
	}
	if ("samlConfig" in record) {
		mapped.samlConfig = await mapConfigField(record.samlConfig, transform);
	}
	return mapped as T;
}

function wrapTransactionAdapter(
	adapter: DBTransactionAdapter,
	secret: string,
): DBTransactionAdapter {
	const encrypt = (json: string) => encryptSsoConfigJson(json, secret);
	const decrypt = (json: string) => decryptSsoConfigJson(json, secret);
	const create: DBAdapter["create"] = async <
		T extends Record<string, unknown>,
		R = T,
	>(args: {
		model: string;
		data: Omit<T, "id">;
		select?: string[];
		forceAllowId?: boolean;
	}): Promise<R> => {
		if (args.model !== "ssoProvider") {
			return adapter.create<T, R>(args);
		}
		const row = await adapter.create<T, R>({
			...args,
			data: await mapSsoConfigs(args.data, encrypt),
		});
		return mapSsoConfigs(row, decrypt);
	};
	const findMany = async <T>(
		args: Parameters<DBAdapter["findMany"]>[0],
	): Promise<T[]> => {
		const rows = await adapter.findMany<T>(args);
		if (args.model !== "ssoProvider") {
			return rows;
		}
		return Promise.all(rows.map((row) => mapSsoConfigs(row, decrypt)));
	};
	const findOne = async <T>(
		args: Parameters<DBAdapter["findOne"]>[0],
	): Promise<T | null> => {
		const row = await adapter.findOne<T>(args);
		if (args.model !== "ssoProvider") {
			return row;
		}
		return mapSsoConfigs(row, decrypt);
	};
	const update: DBAdapter["update"] = async <T>(
		args: Parameters<DBAdapter["update"]>[0],
	): Promise<T | null> => {
		if (args.model !== "ssoProvider") {
			return adapter.update<T>(args);
		}
		const row = await adapter.update<T>({
			...args,
			update: await mapSsoConfigs(args.update, encrypt),
		});
		return mapSsoConfigs(row, decrypt);
	};
	const updateMany: DBAdapter["updateMany"] = async (args) =>
		adapter.updateMany(
			args.model === "ssoProvider"
				? {
						...args,
						update: await mapSsoConfigs(args.update, encrypt),
					}
				: args,
		);
	const consumeOne: DBAdapter["consumeOne"] = async <T>(
		args: Parameters<DBAdapter["consumeOne"]>[0],
	): Promise<T | null> => {
		const row = await adapter.consumeOne<T>(args);
		return args.model === "ssoProvider" ? mapSsoConfigs(row, decrypt) : row;
	};
	const incrementOne: DBAdapter["incrementOne"] = async <T>(
		args: Parameters<DBAdapter["incrementOne"]>[0],
	): Promise<T | null> => {
		const row = await adapter.incrementOne<T>(
			args.model === "ssoProvider" && args.set
				? {
						...args,
						set: await mapSsoConfigs(args.set, encrypt),
					}
				: args,
		);
		return args.model === "ssoProvider" ? mapSsoConfigs(row, decrypt) : row;
	};

	return {
		...adapter,
		consumeOne,
		create,
		findMany,
		findOne,
		incrementOne,
		update,
		updateMany,
	};
}

function wrapAdapter(adapter: DBAdapter, secret: string): DBAdapter {
	return {
		...wrapTransactionAdapter(adapter, secret),
		transaction: (callback) =>
			adapter.transaction((transactionAdapter) =>
				callback(wrapTransactionAdapter(transactionAdapter, secret)),
			),
	};
}

export function withSsoConfigCrypto(
	adapterFactory: DBAdapterInstance,
	secret: string,
): DBAdapterInstance {
	return (options) => wrapAdapter(adapterFactory(options), secret);
}
