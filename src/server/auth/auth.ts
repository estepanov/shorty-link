import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { i18n } from "@better-auth/i18n";
import { passkey } from "@better-auth/passkey";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { createDb } from "../db/client";
import { schema } from "../db/schema";
import {
  completePasskeyRegistrationUser,
  resolvePasskeyRegistrationUser,
} from "./onboarding";

const runtimeEnv = env as typeof env & {
  BETTER_AUTH_ALLOWED_HOSTS?: string;
  BETTER_AUTH_FALLBACK_URL?: string;
  BETTER_AUTH_SECRET?: string;
  PASSKEY_RP_ID?: string;
  PASSKEY_RP_NAME?: string;
};

function splitHosts(value?: string) {
  return (value ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}

function fallbackUrl(request?: Request) {
  if (runtimeEnv.BETTER_AUTH_FALLBACK_URL) {
    return runtimeEnv.BETTER_AUTH_FALLBACK_URL;
  }

  return request ? new URL(request.url).origin : "http://localhost:3000";
}

export function createAuth(request?: Request) {
  const db = createDb();
  const allowedHosts = splitHosts(runtimeEnv.BETTER_AUTH_ALLOWED_HOSTS);
  const origin = request ? new URL(request.url).origin : fallbackUrl();

  return betterAuth({
    appName: "Shorty Link",
    basePath: "/api/auth",
    baseURL: allowedHosts.length
      ? {
          allowedHosts,
          fallback: fallbackUrl(request),
          protocol: "auto",
        }
      : origin,
    secret:
      runtimeEnv.BETTER_AUTH_SECRET ??
      "shorty-link-local-development-secret-change-me",
    trustedOrigins: (incomingRequest) => {
      const requestOrigin = incomingRequest
        ? new URL(incomingRequest.url).origin
        : origin;
      return [requestOrigin, fallbackUrl(incomingRequest)];
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    emailAndPassword: {
      enabled: false,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "admin",
        },
        locale: {
          type: "string",
          required: false,
          defaultValue: "en",
        },
      },
      changeEmail: {
        enabled: false,
      },
    },
    plugins: [
      passkey({
        origin,
        rpID: runtimeEnv.PASSKEY_RP_ID ?? new URL(origin).hostname,
        rpName: runtimeEnv.PASSKEY_RP_NAME ?? "Shorty Link",
        registration: {
          requireSession: false,
          resolveUser: async ({ context }) =>
            resolvePasskeyRegistrationUser(db, context ?? undefined),
          afterVerification: async ({ context, user }) => ({
            userId: await completePasskeyRegistrationUser(
              db,
              context ?? undefined,
              user.id,
            ),
          }),
          extensions: { credProps: true },
        },
        authentication: {
          extensions: { credProps: true },
        },
      }),
      apiKey({
        apiKeyHeaders: ["x-api-key", "authorization"],
        defaultPrefix: "sl_",
        enableSessionForAPIKeys: true,
        requireName: true,
        rateLimit: {
          enabled: true,
          maxRequests: 120,
          timeWindow: 60_000,
        },
      }),
      i18n({
        translations: {
          es: {
            USER_NOT_FOUND: "Usuario no encontrado",
            INVALID_EMAIL_OR_PASSWORD: "Email o contrasena invalida",
            INVALID_PASSWORD: "Contrasena invalida",
            SESSION_EXPIRED: "La sesion expiro",
          },
        },
        detection: ["session", "cookie", "header"],
        localeCookie: "shorty_locale",
        userLocaleField: "locale",
      }),
      tanstackStartCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;
