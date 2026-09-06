import { decryptSsoConfigJson, encryptSsoConfigJson } from "./sso-secrets";

const SSO_PROVIDER_MODEL = "ssoProvider";
const CONFIG_FIELDS = ["oidcConfig", "samlConfig"] as const;

export function isSsoProviderModel(model: string) {
	return model === SSO_PROVIDER_MODEL;
}

export function encodeSsoConfigJson(json: string, secret: string) {
	return encryptSsoConfigJson(json, secret);
}

export function decodeSsoConfigJson(json: string, secret: string) {
	return decryptSsoConfigJson(json, secret);
}

async function transformRecord<T>(
	row: T,
	transform: (json: string) => Promise<string>,
): Promise<T> {
	if (!row || typeof row !== "object") {
		return row;
	}
	const record = row as Record<string, unknown>;
	if (!CONFIG_FIELDS.some((field) => field in record)) {
		return row;
	}
	const mapped = { ...record };
	for (const field of CONFIG_FIELDS) {
		const value = record[field];
		if (typeof value === "string" && value) {
			mapped[field] = await transform(value);
		}
	}
	return mapped as T;
}

export function encodeSsoProviderRecord<T>(row: T, secret: string) {
	return transformRecord(row, (json) => encodeSsoConfigJson(json, secret));
}

export function decodeSsoProviderRecord<T>(row: T, secret: string) {
	return transformRecord(row, (json) => decodeSsoConfigJson(json, secret));
}
