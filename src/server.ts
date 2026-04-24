import { env } from "cloudflare:workers";
import handler from "@tanstack/react-start/server-entry";
import { app } from "./server/api/app";
import { createAuth } from "./server/auth/auth";

const runtimeEnv = env as typeof env & {
	DEBUG_AUTH_ERRORS?: string;
};

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
	const next = new Response(response.body, response);
	const { headers } = next;
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

	return next;
}

export default {
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/auth/")) {
			const isPasskeyPath = url.pathname.toLowerCase().includes("passkey");
			const friendly = () =>
				Response.json(
					{
						code: "PASSKEY_VERIFY_FAILED",
						message: "errors.passkeyVerifyFailed",
					},
					{ status: 400 },
				);

			try {
				const response = await createAuth(request).handler(request);
				if (isPasskeyPath && response.status >= 500) {
					if (runtimeEnv.DEBUG_AUTH_ERRORS === "true") {
						const body = await response
							.clone()
							.text()
							.catch(() => "");
						console.error(
							"auth handler 5xx",
							url.pathname,
							response.status,
							body,
						);
					} else {
						console.error("auth handler 5xx", url.pathname, response.status);
					}
					return applySecurityHeaders(request, friendly());
				}
				return applySecurityHeaders(request, response);
			} catch (error) {
				if (runtimeEnv.DEBUG_AUTH_ERRORS === "true") {
					console.error("auth handler crashed", url.pathname, error);
				} else {
					console.error(
						"auth handler crashed",
						url.pathname,
						error instanceof Error ? error.name : typeof error,
					);
				}
				if (isPasskeyPath) {
					return applySecurityHeaders(request, friendly());
				}
				throw error;
			}
		}

		if (shouldUseElysia(request)) {
			return applySecurityHeaders(request, await app.fetch(request));
		}

		return applySecurityHeaders(request, await handler.fetch(request));
	},
} satisfies ExportedHandler;
