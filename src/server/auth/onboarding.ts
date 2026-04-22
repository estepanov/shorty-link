import { and, count, eq, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { nanoid } from "nanoid";

import { normalizeLocale } from "@/lib/i18n";

import type { AppDb } from "../db/client";
import { adminInvites, user } from "../db/schema";
import { acceptInvite, getBootstrapState, getInviteByToken, now } from "../services/links";

const runtimeEnv = env as typeof env & {
  BETTER_AUTH_SECRET?: string;
};

type OnboardingContext = {
  email: string;
  exp: number;
  inviteToken?: string;
  locale: string;
  name: string;
  role: "admin";
  type: "bootstrap" | "invite";
};

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  if (aBytes.length !== bBytes.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    diff |= aBytes[index]! ^ bBytes[index]!;
  }

  return diff === 0;
}

function authSecret() {
  const secret = runtimeEnv.BETTER_AUTH_SECRET;
  if (secret) {
    return secret;
  }

  return "shorty-link-local-development-secret-change-me";
}

export async function createOnboardingContext(input: OnboardingContext) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(input)));
  const signature = await hmac(authSecret(), payload);
  return `${payload}.${signature}`;
}

export async function readOnboardingContext(context: string | undefined) {
  if (!context) {
    throw new Error("errors.unauthorized");
  }

  const [payload, signature] = context.split(".");
  if (!payload || !signature) {
    throw new Error("errors.unauthorized");
  }

  const expected = await hmac(authSecret(), payload);
  if (!timingSafeEqual(signature, expected)) {
    throw new Error("errors.unauthorized");
  }

  const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as OnboardingContext;
  if (!parsed.exp || parsed.exp < Date.now()) {
    throw new Error("errors.unauthorized");
  }

  return parsed;
}

export async function createBootstrapContext(
  db: AppDb,
  input: { email: string; name: string; locale?: string },
) {
  const bootstrap = await getBootstrapState(db);
  if (!bootstrap.canBootstrap) {
    throw new Error("errors.bootstrapComplete");
  }

  return createOnboardingContext({
    email: input.email.trim().toLowerCase(),
    exp: Date.now() + 10 * 60 * 1000,
    locale: normalizeLocale(input.locale),
    name: input.name.trim(),
    role: "admin",
    type: "bootstrap",
  });
}

export async function createInviteContext(
  db: AppDb,
  input: { token: string; name: string; locale?: string },
) {
  const invite = await getInviteByToken(db, input.token);
  if (!invite) {
    throw new Error("errors.inviteMissing");
  }

  return createOnboardingContext({
    email: invite.email,
    exp: Date.now() + 10 * 60 * 1000,
    inviteToken: invite.token,
    locale: normalizeLocale(input.locale),
    name: input.name.trim(),
    role: "admin",
    type: "invite",
  });
}

async function findUserByEmail(db: AppDb, email: string) {
  const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  return rows[0] ?? null;
}

async function assertOnboardingAllowed(
  db: AppDb,
  parsed: OnboardingContext,
  email: string,
) {
  if (parsed.type === "bootstrap") {
    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(user);
    if (Number(totalUsers) > 0) {
      throw new Error("errors.bootstrapComplete");
    }
  }

  if (parsed.type === "invite") {
    if (!parsed.inviteToken) {
      throw new Error("errors.inviteMissing");
    }

    const invite = await db
      .select()
      .from(adminInvites)
      .where(
        and(
          eq(adminInvites.token, parsed.inviteToken),
          eq(adminInvites.email, email),
          isNull(adminInvites.acceptedAt),
        ),
      )
      .limit(1);

    if (!invite[0] || invite[0].expiresAt < now()) {
      throw new Error("errors.inviteMissing");
    }
  }
}

export async function resolvePasskeyRegistrationUser(db: AppDb, context?: string) {
  const parsed = await readOnboardingContext(context);
  const email = parsed.email.trim().toLowerCase();
  const existing = await findUserByEmail(db, email);

  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
    };
  }

  await assertOnboardingAllowed(db, parsed, email);

  return { id: nanoid(), email, name: parsed.name };
}

export async function completePasskeyRegistrationUser(
  db: AppDb,
  context: string | undefined,
  id: string,
) {
  const parsed = await readOnboardingContext(context);
  const email = parsed.email.trim().toLowerCase();
  const existing = await findUserByEmail(db, email);

  if (existing) {
    return existing.id;
  }

  await assertOnboardingAllowed(db, parsed, email);

  const timestamp = new Date();
  await db.insert(user).values({
    id,
    email,
    emailVerified: true,
    image: null,
    locale: normalizeLocale(parsed.locale),
    name: parsed.name,
    role: "admin",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  if (parsed.type === "invite" && parsed.inviteToken) {
    await acceptInvite(db, parsed.inviteToken);
  }

  return id;
}
