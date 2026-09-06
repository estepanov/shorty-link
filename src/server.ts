import handler from "@tanstack/react-start/server-entry";
import { app } from "./server/api/app";
import { createAuth } from "./server/auth/auth";
import { getLogger, serializeError } from "./server/logging";

const serverLog = getLogger(["server"]);
const authLog = getLogger(["auth"]);

const RESERVED_EXACT_PATHS = new Set([
	"/admin",
	"/api",
	"/favicon.ico",
	"/robots.txt",
	"/manifest.webmanifest",
]);

const RESERVED_PREFIXES = ["/admin/", "/api/", "/assets/", "/_build/"];

const HTML_CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"base-uri 'self'",
	"connect-src 'self'",
	"font-src 'self' data:",
	"frame-ancestors 'none'",
	"img-src 'self' data: https:",
	"object-src 'none'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
].join("; ");

type RequestContext = {
	requestId: string;
	method: string;
	path: string;
};

function makeContext(request: Request): RequestContext {
	return {
		requestId: crypto.randomUUID(),
		method: request.method,
		path: new URL(request.url).pathname,
	};
}

function isReservedPath(pathname: string) {
	return (
		RESERVED_EXACT_PATHS.has(pathname) ||
		RESERVED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
	);
}

function shouldUseElysia(request: Request) {
	const url = new URL(request.url);

	if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
		return true;
	}

	if (!["GET", "HEAD"].includes(request.method)) {
		return false;
	}

	if (url.pathname === "/") {
		return false;
	}

	return !isReservedPath(url.pathname);
}

function applySecurityHeaders(request: Request, response: Response) {
	const headers = new Headers(response.headers);
	const contentType = headers.get("content-type")?.toLowerCase() ?? "";

	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Frame-Options", "DENY");

	if (new URL(request.url).protocol === "https:") {
		headers.set(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains",
		);
	}

	if (contentType.includes("text/html")) {
		headers.set("Content-Security-Policy", HTML_CONTENT_SECURITY_POLICY);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function passkeyFriendlyResponse() {
	return Response.json(
		{
			code: "PASSKEY_VERIFY_FAILED",
			message: "errors.passkeyVerifyFailed",
		},
		{ status: 400 },
	);
}

function genericErrorResponse() {
	return Response.json(
		{ code: "INTERNAL_ERROR", message: "errors.unknown" },
		{ status: 500 },
	);
}

async function handleAuthRequest(request: Request, ctx: RequestContext) {
	const isPasskeyPath = ctx.path.toLowerCase().includes("passkey");
	authLog.debug("auth handler invoked", ctx);

	try {
		const auth = createAuth(request);
		const response = await auth.handler(request);
		const status = response.status;
		const fields = { ...ctx, status };

		if (status >= 500) {
			const body = await response.text().catch(() => null);
			authLog.error("auth handler returned 5xx", { ...fields, body });
			if (isPasskeyPath) {
				return applySecurityHeaders(request, passkeyFriendlyResponse());
			}
			return applySecurityHeaders(
				request,
				new Response(body ?? "", {
					status,
					statusText: response.statusText,
					headers: response.headers,
				}),
			);
		}

		if (status >= 400) {
			authLog.warn("auth handler returned 4xx", fields);
		} else {
			authLog.debug("auth handler returned ok", fields);
		}
		return applySecurityHeaders(request, response);
	} catch (error) {
		authLog.error("auth handler threw", {
			...ctx,
			error: serializeError(error),
		});
		if (isPasskeyPath) {
			return applySecurityHeaders(request, passkeyFriendlyResponse());
		}
		return applySecurityHeaders(request, genericErrorResponse());
	}
}

export default {
	async fetch(request) {
		const ctx = makeContext(request);
		serverLog.debug(`${ctx.path}`, ctx);

		try {
			if (ctx.path.startsWith("/api/auth/")) {
				return await handleAuthRequest(request, ctx);
			}

			if (shouldUseElysia(request)) {
				const response = await app.fetch(request);
				serverLog.debug("elysia response", {
					...ctx,
					status: response.status,
				});
				return applySecurityHeaders(request, response);
			}

			const response = await handler.fetch(request);
			serverLog.debug("react response", { ...ctx, status: response.status });
			return applySecurityHeaders(request, response);
		} catch (error) {
			serverLog.error("worker fetch threw", {
				...ctx,
				error: serializeError(error),
			});
			return applySecurityHeaders(request, genericErrorResponse());
		}
	},
} satisfies ExportedHandler;
