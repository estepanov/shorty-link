import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeLocale } from "@/lib/i18n";

import type { AppDb } from "../db/client";
import { SYSTEM_ROLE_OWNER, user } from "../db/schema";
import { createAuth } from "./auth";
import { isLocalHostname } from "./security";

type RuntimeEnv = {
	AGENT_BROWSER_AUTH_ENABLED?: string;
	AGENT_BROWSER_AUTH_SECRET?: string;
};

type CookieAttributes = {
	domain?: string;
	httpOnly?: boolean;
	maxAge?: number;
	path?: string;
	sameSite?: string;
	secure?: boolean;
};

const DEFAULT_AGENT_EMAIL = "agent@localhost.test";
const DEFAULT_AGENT_NAME = "Browser Agent";

function timingSafeEqual(a: string, b: string) {
	const aBytes = new TextEncoder().encode(a);
	const bBytes = new TextEncoder().encode(b);

	if (aBytes.length !== bBytes.length) {
		return false;
	}

	let diff = 0;
	for (let index = 0; index < aBytes.length; index += 1) {
		diff |= aBytes[index] ^ bBytes[index];
	}

	return diff === 0;
}

function getRequestSecret(request: Request) {
	const url = new URL(request.url);
	return (
		request.headers.get("x-agent-auth-secret") ??
		url.searchParams.get("secret") ??
		""
	);
}

function getRedirectPath(request: Request) {
	const redirect =
		new URL(request.url).searchParams.get("redirect") ?? "/admin";
	if (!redirect.startsWith("/") || redirect.startsWith("//")) {
		return "/admin";
	}
	return redirect;
}

function appendCookieAttribute(parts: string[], name: string, value?: unknown) {
	if (value === undefined || value === null || value === false) {
		return;
	}
	if (value === true) {
		parts.push(name);
		return;
	}
	parts.push(`${name}=${String(value)}`);
}

function serializeCookie(
	name: string,
	value: string,
	attributes: CookieAttributes,
) {
	const parts = [`${name}=${value}`];
	appendCookieAttribute(parts, "Max-Age", attributes.maxAge);
	appendCookieAttribute(parts, "Domain", attributes.domain);
	appendCookieAttribute(parts, "Path", attributes.path);
	appendCookieAttribute(parts, "HttpOnly", attributes.httpOnly);
	appendCookieAttribute(parts, "Secure", attributes.secure);
	appendCookieAttribute(
		parts,
		"SameSite",
		attributes.sameSite
			? `${attributes.sameSite.charAt(0).toUpperCase()}${attributes.sameSite.slice(1)}`
			: undefined,
	);
	return parts.join("; ");
}

async function signedCookieValue(value: string, secret: string | BufferSource) {
	return encodeURIComponent(`${value}.${await makeSignature(value, secret)}`);
}

async function ensureAgentUser(
	db: AppDb,
	input: {
		email: string;
		locale?: string;
		name: string;
	},
) {
	const email = input.email.trim().toLowerCase();
	const locale = normalizeLocale(input.locale);
	const name = input.name.trim() || DEFAULT_AGENT_NAME;
	const timestamp = new Date();
	const [existing] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);

	if (existing) {
		await db
			.update(user)
			.set({
				isActive: true,
				locale,
				name,
				roleId: SYSTEM_ROLE_OWNER,
				updatedAt: timestamp,
			})
			.where(eq(user.id, existing.id));
		return { email, id: existing.id, name };
	}

	const id = nanoid();
	await db.insert(user).values({
		createdAt: timestamp,
		email,
		emailVerified: true,
		id,
		image: null,
		isActive: true,
		locale,
		name,
		roleId: SYSTEM_ROLE_OWNER,
		updatedAt: timestamp,
	});
	return { email, id, name };
}

function disabledResponse() {
	return new Response("Not found", {
		headers: { "Cache-Control": "no-store" },
		status: 404,
	});
}

export async function createAgentLoginResponse({
	db,
	env,
	request,
}: {
	db: AppDb;
	env: RuntimeEnv;
	request: Request;
}) {
	const url = new URL(request.url);
	if (
		env.AGENT_BROWSER_AUTH_ENABLED !== "true" ||
		!env.AGENT_BROWSER_AUTH_SECRET ||
		!isLocalHostname(url.hostname)
	) {
		return disabledResponse();
	}

	if (
		!timingSafeEqual(getRequestSecret(request), env.AGENT_BROWSER_AUTH_SECRET)
	) {
		return new Response("Forbidden", {
			headers: { "Cache-Control": "no-store" },
			status: 403,
		});
	}

	const agentUser = await ensureAgentUser(db, {
		email: url.searchParams.get("email") ?? DEFAULT_AGENT_EMAIL,
		locale: url.searchParams.get("locale") ?? undefined,
		name: url.searchParams.get("name") ?? DEFAULT_AGENT_NAME,
	});
	const auth = createAuth(request);
	const context = await auth.$context;
	const session = await context.internalAdapter.createSession(
		agentUser.id,
		false,
		{
			ipAddress:
				request.headers.get("cf-connecting-ip") ??
				request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
				"",
			userAgent: request.headers.get("user-agent") ?? "",
		},
	);
	const cookie = serializeCookie(
		context.authCookies.sessionToken.name,
		await signedCookieValue(session.token, context.secret),
		{
			...context.authCookies.sessionToken.attributes,
			maxAge: context.sessionConfig.expiresIn,
		},
	);
	const headers = new Headers({
		"Cache-Control": "no-store",
		Location: getRedirectPath(request),
	});
	headers.append("Set-Cookie", cookie);

	if (request.headers.get("accept")?.includes("application/json")) {
		headers.delete("Location");
		return Response.json(
			{
				redirectTo: getRedirectPath(request),
				sessionId: session.id,
				user: agentUser,
			},
			{ headers },
		);
	}

	return new Response(null, {
		headers,
		status: 302,
	});
}
