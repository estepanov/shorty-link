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
					return friendly();
				}
				return response;
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
					return friendly();
				}
				throw error;
			}
		}

		if (shouldUseElysia(request)) {
			return app.fetch(request);
		}

		return handler.fetch(request);
	},
} satisfies ExportedHandler;
