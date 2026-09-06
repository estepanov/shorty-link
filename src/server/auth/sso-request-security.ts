const OIDC_CALLBACK_PATH = /^\/api\/auth\/sso\/callback\/([a-z0-9][a-z0-9-]*)$/;
const OIDC_INITIATION_PATH = "/api/auth/sign-in/sso";

export type SsoInitiationBody = {
	callbackURL?: unknown;
	errorCallbackURL?: unknown;
	newUserCallbackURL?: unknown;
	providerId?: unknown;
	providerType?: unknown;
};

function isShortyCallback(value: unknown, shortyOrigin: string) {
	if (typeof value !== "string" || !value) {
		return false;
	}
	try {
		return new URL(value, shortyOrigin).origin === shortyOrigin;
	} catch {
		return false;
	}
}

export function hasTrustedShortySource(request: Request, shortyOrigin: string) {
	const source =
		request.headers.get("origin") ?? request.headers.get("referer");
	if (!source) {
		return request.headers.get("sec-fetch-site") !== "cross-site";
	}
	try {
		return new URL(source).origin === shortyOrigin;
	} catch {
		return false;
	}
}

export function hasTrustedShortyCallbacks(
	body: SsoInitiationBody,
	shortyOrigin: string,
) {
	return (
		isShortyCallback(body.callbackURL, shortyOrigin) &&
		(body.errorCallbackURL === undefined ||
			isShortyCallback(body.errorCallbackURL, shortyOrigin)) &&
		(body.newUserCallbackURL === undefined ||
			isShortyCallback(body.newUserCallbackURL, shortyOrigin))
	);
}

export async function oidcProviderIdForTrustedOrigins(
	request: Request,
	shortyOrigin: string,
) {
	const pathname = new URL(request.url).pathname;
	const callbackMatch = OIDC_CALLBACK_PATH.exec(pathname);
	if (callbackMatch && request.method === "GET") {
		return callbackMatch[1] ?? null;
	}
	if (pathname !== OIDC_INITIATION_PATH || request.method !== "POST") {
		return null;
	}
	if (!hasTrustedShortySource(request, shortyOrigin)) {
		return null;
	}

	let body: SsoInitiationBody;
	try {
		body = (await request.clone().json()) as SsoInitiationBody;
	} catch {
		return null;
	}
	if (
		!body ||
		typeof body !== "object" ||
		Array.isArray(body) ||
		!hasTrustedShortyCallbacks(body, shortyOrigin)
	) {
		return null;
	}
	if (
		(body.providerType !== undefined && body.providerType !== "oidc") ||
		typeof body.providerId !== "string" ||
		!OIDC_CALLBACK_PATH.test(`/api/auth/sso/callback/${body.providerId}`)
	) {
		return null;
	}
	return body.providerId;
}
