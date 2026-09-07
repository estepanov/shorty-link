import { isPublicRoutableHost } from "@better-auth/core/utils/host";

function parseHttpUrl(value: unknown) {
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

export function isOidcEndpointAllowed(value: unknown, trustedOrigin: string) {
	const url = parseHttpUrl(value);
	return (
		url !== null &&
		(url.origin === trustedOrigin || isPublicRoutableHost(url.hostname))
	);
}

export function isOidcDiscoveryEndpointAllowed(
	value: unknown,
	trustedOrigin: string,
) {
	return parseHttpUrl(value)?.origin === trustedOrigin;
}
