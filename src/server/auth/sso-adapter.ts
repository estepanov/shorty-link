import { decryptSsoConfigJson, encryptSsoConfigJson } from "./sso-secrets";

type AdapterRecord = Record<string, unknown>;

type AdapterLike = {
	create: (args: { data: AdapterRecord; model: string }) => Promise<unknown>;
	findMany: (args: { model: string } & AdapterRecord) => Promise<unknown[]>;
	findOne: (args: { model: string } & AdapterRecord) => Promise<unknown>;
	update: (args: { model: string; update: AdapterRecord }) => Promise<unknown>;
};

async function mapConfigField(
	value: unknown,
	transform: (json: string) => Promise<string>,
) {
	if (typeof value !== "string" || !value) {
		return value;
	}
	return transform(value);
}

async function mapSsoConfigs(
	row: unknown,
	transform: (json: string) => Promise<string>,
) {
	if (!row || typeof row !== "object") {
		return row;
	}
	const record = row as AdapterRecord;
	return {
		...record,
		oidcConfig: await mapConfigField(record.oidcConfig, transform),
		samlConfig: await mapConfigField(record.samlConfig, transform),
	};
}

function wrapAdapter<T extends object>(adapter: T, secret: string): T {
	const encrypt = (json: string) => encryptSsoConfigJson(json, secret);
	const decrypt = (json: string) => decryptSsoConfigJson(json, secret);
	const next = adapter as T & AdapterLike;
	return {
		...next,
		async create(args: { data: AdapterRecord; model: string }) {
			if (args.model !== "ssoProvider") {
				return next.create(args);
			}
			return next.create({
				...args,
				data: (await mapSsoConfigs(args.data, encrypt)) as AdapterRecord,
			});
		},
		async findMany(args: { model: string } & AdapterRecord) {
			const rows = await next.findMany(args);
			if (args.model !== "ssoProvider") {
				return rows;
			}
			return Promise.all(rows.map((row) => mapSsoConfigs(row, decrypt)));
		},
		async findOne(args: { model: string } & AdapterRecord) {
			const row = await next.findOne(args);
			if (args.model !== "ssoProvider") {
				return row;
			}
			return mapSsoConfigs(row, decrypt);
		},
		async update(args: { model: string; update: AdapterRecord }) {
			if (args.model !== "ssoProvider") {
				return next.update(args);
			}
			return next.update({
				...args,
				update: (await mapSsoConfigs(args.update, encrypt)) as AdapterRecord,
			});
		},
	} as T;
}

export function withSsoConfigCrypto<T>(adapterOrFactory: T, secret: string): T {
	if (typeof adapterOrFactory === "function") {
		const factory = adapterOrFactory as (options: unknown) => object;
		return ((options: unknown) => wrapAdapter(factory(options), secret)) as T;
	}
	if (adapterOrFactory && typeof adapterOrFactory === "object") {
		return wrapAdapter(adapterOrFactory, secret);
	}
	return adapterOrFactory;
}
