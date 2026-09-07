import type {
	DBAdapter,
	DBAdapterInstance,
	DBTransactionAdapter,
} from "@better-auth/core/db/adapter";

import {
	decodeSsoProviderRecord,
	encodeSsoProviderRecord,
	isSsoProviderModel,
} from "./sso-config-codec";

function wrapTransactionAdapter(
	adapter: DBTransactionAdapter,
	secret: string,
): DBTransactionAdapter {
	const create: DBAdapter["create"] = async <
		T extends Record<string, unknown>,
		R = T,
	>(args: {
		model: string;
		data: Omit<T, "id">;
		select?: string[];
		forceAllowId?: boolean;
	}): Promise<R> => {
		if (!isSsoProviderModel(args.model)) {
			return adapter.create<T, R>(args);
		}
		const row = await adapter.create<T, R>({
			...args,
			data: await encodeSsoProviderRecord(args.data, secret),
		});
		return decodeSsoProviderRecord(row, secret);
	};
	const findMany = async <T>(
		args: Parameters<DBAdapter["findMany"]>[0],
	): Promise<T[]> => {
		const rows = await adapter.findMany<T>(args);
		if (!isSsoProviderModel(args.model)) {
			return rows;
		}
		return Promise.all(rows.map((row) => decodeSsoProviderRecord(row, secret)));
	};
	const findOne = async <T>(
		args: Parameters<DBAdapter["findOne"]>[0],
	): Promise<T | null> => {
		const row = await adapter.findOne<T>(args);
		if (!isSsoProviderModel(args.model)) {
			return row;
		}
		return decodeSsoProviderRecord(row, secret);
	};
	const update: DBAdapter["update"] = async <T>(
		args: Parameters<DBAdapter["update"]>[0],
	): Promise<T | null> => {
		if (!isSsoProviderModel(args.model)) {
			return adapter.update<T>(args);
		}
		const row = await adapter.update<T>({
			...args,
			update: await encodeSsoProviderRecord(args.update, secret),
		});
		return decodeSsoProviderRecord(row, secret);
	};
	const updateMany: DBAdapter["updateMany"] = async (args) =>
		adapter.updateMany(
			isSsoProviderModel(args.model)
				? {
						...args,
						update: await encodeSsoProviderRecord(args.update, secret),
					}
				: args,
		);
	const consumeOne: DBAdapter["consumeOne"] = async <T>(
		args: Parameters<DBAdapter["consumeOne"]>[0],
	): Promise<T | null> => {
		const row = await adapter.consumeOne<T>(args);
		return isSsoProviderModel(args.model)
			? decodeSsoProviderRecord(row, secret)
			: row;
	};
	const incrementOne: DBAdapter["incrementOne"] = async <T>(
		args: Parameters<DBAdapter["incrementOne"]>[0],
	): Promise<T | null> => {
		const row = await adapter.incrementOne<T>(
			isSsoProviderModel(args.model) && args.set
				? {
						...args,
						set: await encodeSsoProviderRecord(args.set, secret),
					}
				: args,
		);
		return isSsoProviderModel(args.model)
			? decodeSsoProviderRecord(row, secret)
			: row;
	};

	return {
		count: (args) => adapter.count(args),
		consumeOne,
		create,
		createSchema: adapter.createSchema,
		delete: (args) => adapter.delete(args),
		deleteMany: (args) => adapter.deleteMany(args),
		findMany,
		findOne,
		id: adapter.id,
		incrementOne,
		options: adapter.options,
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
