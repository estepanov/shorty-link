type TrustedOriginOptions = {
	allowedHosts?: string[];
	fallbackOrigin?: string | null;
};

function stripHostDecorators(value: string) {
	let normalized = value.trim().toLowerCase();

	if (!normalized) {
		return "";
	}

	try {
		if (normalized.includes("://")) {
			normalized = new URL(normalized).host;
		}
	} catch {
		return "";
	}

	return normalized.replace(/\/.*$/, "");
}

export function splitTrustedHosts(value?: string) {
	return [
		...new Set(
			(value ?? "").split(",").map(stripHostDecorators).filter(Boolean),
		),
	];
}

export function isLocalHostname(hostname: string) {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "[::1]" ||
		hostname === "::1" ||
		hostname.endsWith(".localhost")
	);
}

export function hostMatchesPattern(hostname: string, pattern: string) {
	const normalizedHost = stripHostDecorators(hostname);
	const normalizedPattern = stripHostDecorators(pattern);

	if (!normalizedHost || !normalizedPattern) {
		return false;
	}

	if (normalizedPattern.startsWith("*.")) {
		const suffix = normalizedPattern.slice(2);
		return normalizedHost !== suffix && normalizedHost.endsWith(`.${suffix}`);
	}

	return normalizedHost === normalizedPattern;
}

export function isTrustedHostname(
	hostname: string,
	options: TrustedOriginOptions = {},
) {
	const normalizedHost = stripHostDecorators(hostname);

	if (!normalizedHost) {
		return false;
	}

	if (isLocalHostname(normalizedHost)) {
		return true;
	}

	if (
		(options.allowedHosts ?? []).some((pattern) =>
			hostMatchesPattern(normalizedHost, pattern),
		)
	) {
		return true;
	}

	if (options.fallbackOrigin) {
		try {
			return (
				new URL(options.fallbackOrigin).hostname.toLowerCase() ===
				normalizedHost
			);
		} catch {
			return false;
		}
	}

	return false;
}

export function resolveTrustedRequestOrigin(
	request: Request,
	options: TrustedOriginOptions = {},
) {
	const url = new URL(request.url);
	return isTrustedHostname(url.hostname, options) ? url.origin : null;
}

function sourceOrigin(request: Request) {
	const headerOrigin = request.headers.get("origin");
	if (headerOrigin) {
		try {
			return new URL(headerOrigin).origin;
		} catch {
			return null;
		}
	}

	const referer = request.headers.get("referer");
	if (!referer) {
		return null;
	}

	try {
		return new URL(referer).origin;
	} catch {
		return null;
	}
}

export function shouldEnforceAdminWriteCsrf(request: Request) {
	return (
		!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
		request.headers.has("cookie")
	);
}

export function assertTrustedAdminWrite(request: Request) {
	if (!shouldEnforceAdminWriteCsrf(request)) {
		return;
	}

	const requestOrigin = new URL(request.url).origin;
	if (sourceOrigin(request) === requestOrigin) {
		return;
	}

	throw new Response("errors.forbidden", { status: 403 });
}
