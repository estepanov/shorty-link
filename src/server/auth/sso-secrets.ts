const SECRET_JSON_KEYS = new Set([
	"clientSecret",
	"privateKey",
	"privateKeyPass",
	"encPrivateKey",
	"encPrivateKeyPass",
]);

export const SSO_SECRET_PREFIX = "ssoenc:v1:";

async function importAesKey(secret: string) {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret),
	);
	return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

function bytesToBase64Url(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		"=",
	);
	const binary = atob(padded);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encryptSecretValue(plaintext: string, secret: string) {
	if (plaintext.startsWith(SSO_SECRET_PREFIX)) {
		return plaintext;
	}
	const key = await importAesKey(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(plaintext),
	);
	const payload = new Uint8Array(iv.length + cipher.byteLength);
	payload.set(iv, 0);
	payload.set(new Uint8Array(cipher), iv.length);
	return `${SSO_SECRET_PREFIX}${bytesToBase64Url(payload)}`;
}

export async function decryptSecretValue(ciphertext: string, secret: string) {
	if (!ciphertext.startsWith(SSO_SECRET_PREFIX)) {
		return ciphertext;
	}
	const payload = base64UrlToBytes(ciphertext.slice(SSO_SECRET_PREFIX.length));
	if (payload.length <= 12) {
		throw new Error("errors.ssoSecretDecryptFailed");
	}
	const iv = payload.slice(0, 12);
	const data = payload.slice(12);
	try {
		const key = await importAesKey(secret);
		const plain = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			key,
			data,
		);
		return new TextDecoder().decode(plain);
	} catch {
		throw new Error("errors.ssoSecretDecryptFailed");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function walkSecrets(
	value: unknown,
	transform: (secret: string) => Promise<string>,
): Promise<unknown> {
	if (Array.isArray(value)) {
		return Promise.all(value.map((item) => walkSecrets(item, transform)));
	}
	if (!isRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (SECRET_JSON_KEYS.has(key) && typeof child === "string" && child) {
			next[key] = await transform(child);
		} else {
			next[key] = await walkSecrets(child, transform);
		}
	}
	return next;
}

function parseJsonObject(json: string) {
	const parsed: unknown = JSON.parse(json);
	if (!isRecord(parsed) && !Array.isArray(parsed)) {
		throw new Error("errors.ssoSecretDecryptFailed");
	}
	return parsed;
}

export async function encryptSsoConfigJson(json: string, secret: string) {
	const parsed = parseJsonObject(json);
	return JSON.stringify(
		await walkSecrets(parsed, (value) => encryptSecretValue(value, secret)),
	);
}

export async function decryptSsoConfigJson(json: string, secret: string) {
	const parsed = parseJsonObject(json);
	return JSON.stringify(
		await walkSecrets(parsed, (value) => decryptSecretValue(value, secret)),
	);
}
