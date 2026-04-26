import { and, count, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeLocale } from "@/lib/i18n";

import type { AppDb } from "../db/client";
import {
	adminInvites,
	SYSTEM_ROLE_ADMIN,
	SYSTEM_ROLE_OWNER,
	user,
} from "../db/schema";
import { getBootstrapState, getInviteByToken, now } from "../services/links";
import { getAuthSecret } from "./secret";

type OnboardingContext = {
	email: string;
	exp: number;
	inviteToken?: string;
	invitedBy?: string;
	locale: string;
	name: string;
	roleId: string;
	type: "bootstrap" | "invite";
};

type UserReader = Pick<AppDb, "select">;

function base64UrlEncode(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		"=",
	);
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
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value),
	);
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
		// biome-ignore lint/style/noNonNullAssertion: length equality asserted above; constant-time compare requires direct indexing without short-circuit evaluation.
		diff |= aBytes[index]! ^ bBytes[index]!;
	}

	return diff === 0;
}

export async function createOnboardingContext(
	input: OnboardingContext,
	request?: Request,
) {
	const payload = base64UrlEncode(
		new TextEncoder().encode(JSON.stringify(input)),
	);
	const signature = await hmac(getAuthSecret(request), payload);
	return `${payload}.${signature}`;
}

export async function readOnboardingContext(
	context: string | undefined,
	request?: Request,
) {
	if (!context) {
		throw new Error("errors.unauthorized");
	}

	const [payload, signature] = context.split(".");
	if (!payload || !signature) {
		throw new Error("errors.unauthorized");
	}

	const expected = await hmac(getAuthSecret(request), payload);
	if (!timingSafeEqual(signature, expected)) {
		throw new Error("errors.unauthorized");
	}

	const parsed = JSON.parse(
		new TextDecoder().decode(base64UrlDecode(payload)),
	) as OnboardingContext;
	if (!parsed.exp || parsed.exp < Date.now()) {
		throw new Error("errors.unauthorized");
	}

	return parsed;
}

export async function createBootstrapContext(
	db: AppDb,
	input: { email: string; name: string; locale?: string },
	request?: Request,
) {
	const bootstrap = await getBootstrapState(db);
	if (!bootstrap.canBootstrap) {
		throw new Error("errors.bootstrapComplete");
	}

	return createOnboardingContext(
		{
			email: input.email.trim().toLowerCase(),
			exp: Date.now() + 10 * 60 * 1000,
			locale: normalizeLocale(input.locale),
			name: input.name.trim(),
			roleId: SYSTEM_ROLE_OWNER,
			type: "bootstrap",
		},
		request,
	);
}

export async function createInviteContext(
	db: AppDb,
	input: { token: string; name: string; locale?: string },
	request?: Request,
) {
	const invite = await getInviteByToken(db, input.token);
	if (!invite) {
		throw new Error("errors.inviteMissing");
	}

	return createOnboardingContext(
		{
			email: invite.email,
			exp: Date.now() + 10 * 60 * 1000,
			inviteToken: invite.token,
			invitedBy: invite.invitedBy ?? undefined,
			locale: normalizeLocale(input.locale),
			name: input.name.trim(),
			roleId: invite.roleId,
			type: "invite",
		},
		request,
	);
}

async function findUserByEmail(db: UserReader, email: string) {
	const rows = await db
		.select()
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return rows[0] ?? null;
}

async function assertOnboardingAllowed(
	db: AppDb,
	parsed: OnboardingContext,
	email: string,
) {
	if (parsed.type === "bootstrap") {
		const [{ totalUsers }] = await db
			.select({ totalUsers: count() })
			.from(user);
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

export async function resolvePasskeyRegistrationUser(
	db: AppDb,
	context?: string,
	request?: Request,
) {
	const parsed = await readOnboardingContext(context, request);
	const email = parsed.email.trim().toLowerCase();
	await assertOnboardingAllowed(db, parsed, email);

	const existing = await findUserByEmail(db, email);

	if (existing) {
		return {
			id: existing.id,
			email: existing.email,
			name: existing.name,
		};
	}

	return { id: nanoid(), email, name: parsed.name };
}

export async function completePasskeyRegistrationUser(
	db: AppDb,
	context: string | undefined,
	id: string,
	request?: Request,
) {
	const parsed = await readOnboardingContext(context, request);
	const email = parsed.email.trim().toLowerCase();
	const existing = await findUserByEmail(db, email);
	const timestamp = Math.floor(Date.now() / 1000);
	const locale = normalizeLocale(parsed.locale);
	const roleId =
		parsed.type === "bootstrap" ? SYSTEM_ROLE_OWNER : parsed.roleId;

	if (parsed.type === "bootstrap") {
		if (existing) {
			if (existing.id === id) {
				return existing.id;
			}
			throw new Error("errors.bootstrapComplete");
		}

		const inserted = await db.$client
			.prepare(`
				insert into "user" (
					"id",
					"name",
					"email",
					"email_verified",
					"image",
					"role_id",
					"locale",
					"is_active",
					"invited_by",
					"created_at",
					"updated_at"
				)
				select ?, ?, ?, 1, null, ?, ?, 1, null, ?, ?
				where not exists (select 1 from "user")
			`)
			.bind(id, parsed.name, email, roleId, locale, timestamp, timestamp)
			.run();

		if (inserted.meta.changes !== 1) {
			throw new Error("errors.bootstrapComplete");
		}

		return id;
	}

	if (!parsed.inviteToken) {
		throw new Error("errors.inviteMissing");
	}

	const acceptedAt = now();
	const claimStatement = db.$client
		.prepare(`
			update "admin_invite"
			set "accepted_at" = ?
			where "token" = ?
				and "email" = ?
				and "accepted_at" is null
				and "expires_at" > ?
		`)
		.bind(acceptedAt, parsed.inviteToken, email, acceptedAt);

	if (existing) {
		const claimed = await claimStatement.run();
		if (claimed.meta.changes !== 1) {
			throw new Error("errors.inviteMissing");
		}
		await db
			.update(user)
			.set({
				roleId: roleId ?? SYSTEM_ROLE_ADMIN,
				invitedBy: parsed.invitedBy ?? null,
				updatedAt: new Date(),
			})
			.where(eq(user.id, existing.id));
		return existing.id;
	}

	const insertStatement = db.$client
		.prepare(`
			insert into "user" (
				"id",
				"name",
				"email",
				"email_verified",
				"image",
				"role_id",
				"locale",
				"is_active",
				"invited_by",
				"created_at",
				"updated_at"
			)
			select ?, ?, ?, 1, null, ?, ?, 1, ?, ?, ?
			where exists (
				select 1
				from "admin_invite"
				where "token" = ?
					and "email" = ?
					and "accepted_at" = ?
			)
		`)
		.bind(
			id,
			parsed.name,
			email,
			roleId ?? SYSTEM_ROLE_ADMIN,
			locale,
			parsed.invitedBy ?? null,
			timestamp,
			timestamp,
			parsed.inviteToken,
			email,
			acceptedAt,
		);

	const [claimed, inserted] = await db.$client.batch([
		claimStatement,
		insertStatement,
	]);

	if (claimed.meta.changes !== 1 || inserted.meta.changes !== 1) {
		throw new Error("errors.inviteMissing");
	}

	return id;
}
