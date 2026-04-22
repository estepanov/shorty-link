import handler from "@tanstack/react-start/server-entry";

import { createAuth } from "./server/auth/auth";
import { app } from "./server/api/app";

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
          return friendly();
        }
        return response;
      } catch (error) {
        console.error("auth handler crashed", url.pathname, error);
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
