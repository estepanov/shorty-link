export const API_KEY_PREFIX = "sl_";

export function resolveApiKeyFromHeaders(headers: Headers): string | null {
	const explicit = headers.get("x-api-key")?.trim();
	if (explicit) {
		return explicit;
	}

	const authorization = headers.get("authorization");
	if (!authorization) {
		return null;
	}

	const token = authorization.replace(/^Bearer\s+/i, "").trim();
	if (token.startsWith(API_KEY_PREFIX)) {
		return token;
	}

	return null;
}
