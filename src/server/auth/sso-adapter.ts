import type {
	DBAdapter,
	DBAdapterInstance,
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
	return Object.assign({}, row, {
		oidcConfig: await mapConfigField(record.oidcConfig, transform),
		samlConfig: await mapConfigField(record.samlConfig, transform),
	});
}

function wrapAdapter(adapter: DBAdapter, secret: string): DBAdapter {
	const encrypt = (json: string) => encryptSsoConfigJson(json, secret);
	const decrypt = (json: string) => decryptSsoConfigJson(json, secret);
	const create: DBAdapter["create"] = async (args) => {
		if (args.model !== "ssoProvider") {
			return adapter.create(args);
		}
		return adapter.create({
			...args,
			data: await mapSsoConfigs(args.data, encrypt),
		});
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
	const update: DBAdapter["update"] = async (args) => {
		if (args.model !== "ssoProvider") {
			return adapter.update(args);
		}
		return adapter.update({
			...args,
			update: await mapSsoConfigs(args.update, encrypt),
		});
	};

	return {
		...adapter,
		create,
		findMany,
		findOne,
		update,
	};
}

export function withSsoConfigCrypto(
	adapterFactory: DBAdapterInstance,
	secret: string,
): DBAdapterInstance {
	return (options) => wrapAdapter(adapterFactory(options), secret);
}
