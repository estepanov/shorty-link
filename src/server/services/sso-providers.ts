import { discoverOIDCConfig } from "@better-auth/sso";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
	isSsoEnforcedForEmail,
	type SsoPublicCatalog,
} from "@/lib/sso-catalog";
import type {
	SsoAdminProvider,
	SsoProviderPatch,
	SsoProviderRead,
	SsoProviderWrite,
} from "@/lib/sso-types";
import { getEncryptionSecret } from "../auth/secret";
import {
	decryptSsoConfigJson,
	encryptSsoConfigJson,
	redactSsoConfigJson,
	ssoConfigHasSecret,
} from "../auth/sso-secrets";
import type { AppDb } from "../db/client";
import {
	adminInvites,
	SYSTEM_ROLE_OWNER,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../db/schema";
import { now } from "./links";
import {
	normalizeProtocol,
	normalizeProviderId,
	parseGroupRoleMappings,
	parseProviderDomains,
	resolveSsoAdmission,
	type SsoProtocol,
	type SsoProviderSettingsView,
} from "./sso-admission";

export type {
	SsoAdminProvider,
	SsoGroupRoleMapping,
	SsoProtocol,
	SsoProviderPatch,
	SsoProviderRead,
	SsoProviderWrite,
} from "@/lib/sso-types";

function callbackUrls(origin: string, providerId: string) {
	return {
		acsUrl: `${origin}/api/auth/sso/saml2/sp/acs/${providerId}`,
		callbackUrl: `${origin}/api/auth/sso/callback/${providerId}`,
		spMetadataUrl: `${origin}/api/admin/sso-providers/${providerId}/sp-metadata`,
	};
}

function originFromAbsoluteUrl(value: string | null | undefined) {
	if (!value) {
		return null;
	}
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			return null;
		}
		return url.origin;
	} catch {
		return null;
	}
}

function settingsFromWrite(
	providerId: string,
	protocol: SsoProtocol,
	input: SsoProviderWrite | SsoProviderPatch,
	current?: SsoAdminProvider,
) {
	const defaultRoleId =
		input.defaultRoleId === undefined
			? (current?.defaultRoleId ?? null)
			: input.defaultRoleId;
	const jitEnabled = input.jitEnabled ?? current?.jitEnabled ?? false;
	const mappings = input.groupRoleMappings ?? current?.groupRoleMappings ?? [];
	if (jitEnabled && defaultRoleId === SYSTEM_ROLE_OWNER) {
		throw new Error("errors.ssoOwnerRoleForbidden");
	}
	if (mappings.some((mapping) => mapping.roleId === SYSTEM_ROLE_OWNER)) {
		throw new Error("errors.ssoOwnerRoleForbidden");
	}
	return {
		allowIdpInitiated:
			input.allowIdpInitiated ?? current?.allowIdpInitiated ?? false,
		defaultRoleId,
		displayName: input.displayName ?? current?.displayName ?? "",
		enabled: input.enabled ?? current?.enabled ?? true,
		enforceSso: input.enforceSso ?? current?.enforceSso ?? false,
		groupClaim: input.groupClaim ?? current?.groupClaim ?? "groups",
		groupRoleMappings: mappings,
		jitEnabled,
		protocol,
		providerId,
	};
}

async function persistConfigJson(
	json: string | null,
	request?: Request,
): Promise<string | null> {
	if (!json) {
		return null;
	}
	return encryptSsoConfigJson(json, getEncryptionSecret(request));
}

async function readConfigJson(
	json: string | null | undefined,
	request?: Request,
): Promise<string | null> {
	if (!json) {
		return null;
	}
	return decryptSsoConfigJson(json, getEncryptionSecret(request));
}

async function hydrateOidcConfig(
	input: SsoProviderWrite | SsoProviderPatch,
	issuer: string,
) {
	const allowIdpInitiated = input.allowIdpInitiated ?? false;
	const existing = input.oidcConfig;
	if (existing?.skipDiscovery) {
		return {
			allowIdpInitiated,
			authorizationEndpoint: existing.authorizationEndpoint,
			clientId: input.clientId ?? "",
			clientSecret: input.clientSecret ?? "",
			discoveryEndpoint:
				existing.discoveryEndpoint ??
				`${issuer}/.well-known/openid-configuration`,
			issuer,
			jwksEndpoint: existing.jwksEndpoint,
			pkce: true,
			tokenEndpoint: existing.tokenEndpoint,
			userInfoEndpoint: existing.userInfoEndpoint,
		};
	}

	const issuerOrigin = originFromAbsoluteUrl(issuer);
	const hydrated = await discoverOIDCConfig({
		existingConfig: {
			authorizationEndpoint: existing?.authorizationEndpoint,
			discoveryEndpoint: existing?.discoveryEndpoint,
			jwksEndpoint: existing?.jwksEndpoint,
			tokenEndpoint: existing?.tokenEndpoint,
			userInfoEndpoint: existing?.userInfoEndpoint,
		},
		isTrustedOrigin: (url) => originFromAbsoluteUrl(url) === issuerOrigin,
		issuer,
	});
	return {
		allowIdpInitiated,
		authorizationEndpoint: hydrated.authorizationEndpoint,
		clientId: input.clientId ?? "",
		clientSecret: input.clientSecret ?? "",
		discoveryEndpoint: hydrated.discoveryEndpoint,
		issuer: hydrated.issuer,
		jwksEndpoint: hydrated.jwksEndpoint,
		pkce: true,
		tokenEndpoint: hydrated.tokenEndpoint,
		tokenEndpointAuthentication: hydrated.tokenEndpointAuthentication,
		userInfoEndpoint: hydrated.userInfoEndpoint,
	};
}

function parseConfigRecord(
	json: string | null,
): Record<string, unknown> | null {
	if (!json) {
		return null;
	}
	const parsed: unknown = JSON.parse(json);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}
	return parsed as Record<string, unknown>;
}

function mergeSecret(
	next: Record<string, unknown>,
	current: Record<string, unknown> | null,
	key: string,
	incoming?: string,
) {
	if (incoming) {
		next[key] = incoming;
		return;
	}
	const existing = current?.[key];
	if (typeof existing === "string" && existing) {
		next[key] = existing;
	}
}

async function buildOidcJson(
	input: SsoProviderWrite | SsoProviderPatch,
	issuer: string,
	currentJson: string | null,
) {
	const current = parseConfigRecord(currentJson);
	const hydrated = await hydrateOidcConfig(
		{
			...input,
			clientId:
				input.clientId ??
				(typeof current?.clientId === "string" ? current.clientId : ""),
			clientSecret: input.clientSecret || undefined,
		},
		issuer,
	);
	const record = { ...hydrated } as Record<string, unknown>;
	mergeSecret(record, current, "clientSecret", input.clientSecret);
	return JSON.stringify(record);
}

async function buildSamlJson(
	input: SsoProviderWrite | SsoProviderPatch,
	issuer: string,
	currentJson: string | null,
) {
	const current = parseConfigRecord(currentJson);
	const record: Record<string, unknown> = {
		...(current ?? {}),
		allowIdpInitiated: input.allowIdpInitiated ?? current?.allowIdpInitiated,
		callbackUrl: "/admin",
		issuer,
		...(input.samlConfig ?? {}),
	};
	return JSON.stringify(record);
}

function toAdminProvider(
	provider: typeof ssoProvider.$inferSelect,
	settings: typeof ssoProviderSettings.$inferSelect,
	origin: string,
	oidcJson: string | null,
	samlJson: string | null,
): SsoAdminProvider {
	return {
		...callbackUrls(origin, provider.providerId),
		allowIdpInitiated: settings.allowIdpInitiated,
		defaultRoleId: settings.defaultRoleId,
		displayName: settings.displayName,
		domains: parseProviderDomains(provider.domain),
		enabled: settings.enabled,
		enforceSso: settings.enforceSso,
		groupClaim: settings.groupClaim,
		groupRoleMappings: parseGroupRoleMappings(settings.groupRoleMappings),
		hasClientSecret:
			ssoConfigHasSecret(oidcJson) || ssoConfigHasSecret(samlJson),
		issuer: provider.issuer,
		jitEnabled: settings.jitEnabled,
		protocol: normalizeProtocol(settings.protocol),
		providerId: provider.providerId,
	};
}

async function upsertSettings(
	db: AppDb,
	input: ReturnType<typeof settingsFromWrite>,
) {
	const timestamp = now();
	const values = {
		allowIdpInitiated: input.allowIdpInitiated,
		createdAt: timestamp,
		defaultRoleId: input.defaultRoleId,
		displayName: input.displayName,
		enabled: input.enabled,
		enforceSso: input.enforceSso,
		groupClaim: input.groupClaim.trim() || "groups",
		groupRoleMappings: JSON.stringify(input.groupRoleMappings),
		jitEnabled: input.jitEnabled,
		protocol: input.protocol,
		providerId: input.providerId,
		updatedAt: timestamp,
	};
	const existing = await db
		.select({ providerId: ssoProviderSettings.providerId })
		.from(ssoProviderSettings)
		.where(eq(ssoProviderSettings.providerId, input.providerId))
		.limit(1);
	if (existing[0]) {
		await db
			.update(ssoProviderSettings)
			.set({
				allowIdpInitiated: values.allowIdpInitiated,
				defaultRoleId: values.defaultRoleId,
				displayName: values.displayName,
				enabled: values.enabled,
				enforceSso: values.enforceSso,
				groupClaim: values.groupClaim,
				groupRoleMappings: values.groupRoleMappings,
				jitEnabled: values.jitEnabled,
				protocol: values.protocol,
				updatedAt: timestamp,
			})
			.where(eq(ssoProviderSettings.providerId, input.providerId));
		return;
	}
	await db.insert(ssoProviderSettings).values(values);
}

export async function listPublicSsoProviders(
	db: AppDb,
): Promise<SsoPublicCatalog> {
	const rows = await db
		.select({
			displayName: ssoProviderSettings.displayName,
			domain: ssoProvider.domain,
			enforceSso: ssoProviderSettings.enforceSso,
			protocol: ssoProviderSettings.protocol,
			providerId: ssoProvider.providerId,
		})
		.from(ssoProvider)
		.innerJoin(
			ssoProviderSettings,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(eq(ssoProviderSettings.enabled, true));

	const providers = rows.map((row) => ({
		displayName: row.displayName,
		domains: parseProviderDomains(row.domain),
		enforceSso: row.enforceSso,
		protocol: normalizeProtocol(row.protocol),
		providerId: row.providerId,
	}));

	return {
		hasEnforcedDomain: providers.some((provider) => provider.enforceSso),
		providers,
	};
}

export async function listAdminSsoProviders(db: AppDb, origin: string) {
	const rows = await db
		.select({
			provider: ssoProvider,
			settings: ssoProviderSettings,
		})
		.from(ssoProvider)
		.innerJoin(
			ssoProviderSettings,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		);

	return rows.map(({ provider, settings }) =>
		toAdminProvider(
			provider,
			settings,
			origin,
			provider.oidcConfig,
			provider.samlConfig,
		),
	);
}

export async function getAdminSsoProvider(
	db: AppDb,
	providerId: string,
	origin: string,
	request?: Request,
): Promise<SsoProviderRead> {
	const rows = await db
		.select({
			provider: ssoProvider,
			settings: ssoProviderSettings,
		})
		.from(ssoProvider)
		.innerJoin(
			ssoProviderSettings,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(eq(ssoProvider.providerId, providerId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new Error("errors.ssoProviderMissing");
	}
	const oidcJson = await readConfigJson(row.provider.oidcConfig, request);
	const samlJson = await readConfigJson(row.provider.samlConfig, request);
	return {
		...toAdminProvider(row.provider, row.settings, origin, oidcJson, samlJson),
		oidcConfig: redactSsoConfigJson(oidcJson),
		samlConfig: redactSsoConfigJson(samlJson),
	};
}

export async function createSsoProvider(
	db: AppDb,
	input: SsoProviderWrite,
	actorUserId: string,
	origin: string,
	request?: Request,
) {
	const providerId = normalizeProviderId(input.providerId);
	const protocol = normalizeProtocol(input.protocol);
	const existing = await db
		.select({ providerId: ssoProvider.providerId })
		.from(ssoProvider)
		.where(eq(ssoProvider.providerId, providerId))
		.limit(1);
	if (existing[0]) {
		throw new Error("errors.ssoProviderExists");
	}

	const oidcJson =
		protocol === "oidc"
			? await persistConfigJson(
					await buildOidcJson(input, input.issuer, null),
					request,
				)
			: null;
	const samlJson =
		protocol === "saml"
			? await persistConfigJson(
					await buildSamlJson(input, input.issuer, null),
					request,
				)
			: null;

	await db.insert(ssoProvider).values({
		domain: input.domain,
		id: nanoid(),
		issuer: input.issuer,
		oidcConfig: oidcJson,
		organizationId: null,
		providerId,
		samlConfig: samlJson,
		userId: actorUserId,
	});

	try {
		await upsertSettings(
			db,
			settingsFromWrite(providerId, protocol, { ...input, providerId }),
		);
	} catch (error) {
		await db.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId));
		throw error;
	}

	return getAdminSsoProvider(db, providerId, origin, request);
}

export async function updateSsoProvider(
	db: AppDb,
	providerId: string,
	input: SsoProviderPatch,
	origin: string,
	request?: Request,
) {
	const current = await getAdminSsoProvider(db, providerId, origin, request);
	const protocol = input.protocol
		? normalizeProtocol(input.protocol)
		: current.protocol;
	const issuer = input.issuer ?? current.issuer;
	const rows = await db
		.select()
		.from(ssoProvider)
		.where(eq(ssoProvider.providerId, providerId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new Error("errors.ssoProviderMissing");
	}
	const currentOidc = await readConfigJson(row.oidcConfig, request);
	const currentSaml = await readConfigJson(row.samlConfig, request);
	const oidcJson =
		protocol === "oidc"
			? await persistConfigJson(
					await buildOidcJson(input, issuer, currentOidc),
					request,
				)
			: null;
	const samlJson =
		protocol === "saml"
			? await persistConfigJson(
					await buildSamlJson(input, issuer, currentSaml),
					request,
				)
			: null;

	await db
		.update(ssoProvider)
		.set({
			domain: input.domain ?? row.domain,
			issuer,
			oidcConfig: oidcJson,
			samlConfig: samlJson,
		})
		.where(eq(ssoProvider.providerId, providerId));
	await upsertSettings(
		db,
		settingsFromWrite(providerId, protocol, input, current),
	);
	return getAdminSsoProvider(db, providerId, origin, request);
}

export async function deleteSsoProvider(db: AppDb, providerId: string) {
	await db
		.delete(ssoProviderSettings)
		.where(eq(ssoProviderSettings.providerId, providerId));
	await db.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId));
}

export async function loadSsoSettingsView(db: AppDb, providerId: string) {
	const rows = await db
		.select({
			domain: ssoProvider.domain,
			settings: ssoProviderSettings,
		})
		.from(ssoProviderSettings)
		.innerJoin(
			ssoProvider,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(eq(ssoProviderSettings.providerId, providerId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		return null;
	}
	const view: SsoProviderSettingsView = {
		defaultRoleId: row.settings.defaultRoleId,
		domains: parseProviderDomains(row.domain),
		enabled: row.settings.enabled,
		groupClaim: row.settings.groupClaim,
		groupRoleMappings: parseGroupRoleMappings(row.settings.groupRoleMappings),
		jitEnabled: row.settings.jitEnabled,
		providerId: row.settings.providerId,
	};
	return view;
}

export async function applySsoAdmission(
	db: AppDb,
	input: {
		email: string;
		emailVerified: boolean;
		groups: string[];
		name: string;
		providerId: string;
	},
) {
	const settings = await loadSsoSettingsView(db, input.providerId);
	const existingRows = await db
		.select()
		.from(user)
		.where(eq(user.email, input.email.trim().toLowerCase()))
		.limit(1);
	const existing = existingRows[0] ?? null;
	const inviteRows = await db
		.select()
		.from(adminInvites)
		.where(
			and(
				eq(adminInvites.email, input.email.trim().toLowerCase()),
				isNull(adminInvites.acceptedAt),
			),
		)
		.limit(1);
	const pendingInvite = inviteRows[0];
	const invite =
		pendingInvite && pendingInvite.expiresAt > now() ? pendingInvite : null;

	const decision = resolveSsoAdmission({
		email: input.email,
		emailVerified: input.emailVerified,
		existingUser: existing
			? {
					email: existing.email,
					id: existing.id,
					isActive: existing.isActive,
					roleId: existing.roleId,
				}
			: null,
		groups: input.groups,
		pendingInvite: invite
			? {
					email: invite.email,
					expiresAt: invite.expiresAt,
					invitedBy: invite.invitedBy,
					roleId: invite.roleId,
					token: invite.token,
				}
			: null,
		providerId: input.providerId,
		settings,
	});

	if (!decision.ok) {
		throw new Error(decision.error);
	}

	switch (decision.action) {
		case "sign_in": {
			if (decision.roleChanged) {
				await db
					.update(user)
					.set({ roleId: decision.roleId, updatedAt: new Date() })
					.where(eq(user.id, decision.userId));
			}
			return { userId: decision.userId };
		}
		case "invite": {
			const email = input.email.trim().toLowerCase();
			const timestamp = Math.floor(Date.now() / 1000);
			const id = nanoid();
			const acceptedAt = now();
			const claimed = await db.$client
				.prepare(`
				update "admin_invite"
				set "accepted_at" = ?
				where "token" = ?
					and "email" = ?
					and "accepted_at" is null
					and "expires_at" > ?
			`)
				.bind(acceptedAt, decision.token, email, acceptedAt)
				.run();
			if (claimed.meta.changes !== 1) {
				throw new Error("errors.ssoNotProvisioned");
			}
			await db.$client
				.prepare(`
				insert into "user" (
					"id", "name", "email", "email_verified", "image",
					"role_id", "locale", "is_active", "invited_by",
					"created_at", "updated_at"
				) values (?, ?, ?, 1, null, ?, 'en', 1, ?, ?, ?)
			`)
				.bind(
					id,
					input.name,
					email,
					decision.roleId,
					decision.invitedBy,
					timestamp,
					timestamp,
				)
				.run();
			return { userId: id };
		}
		case "jit": {
			const email = input.email.trim().toLowerCase();
			const timestamp = Math.floor(Date.now() / 1000);
			const id = nanoid();
			await db.$client
				.prepare(`
			insert into "user" (
				"id", "name", "email", "email_verified", "image",
				"role_id", "locale", "is_active", "invited_by",
				"created_at", "updated_at"
			) values (?, ?, ?, 1, null, ?, 'en', 1, null, ?, ?)
		`)
				.bind(id, input.name, email, decision.roleId, timestamp, timestamp)
				.run();
			return { userId: id };
		}
		default: {
			const _exhaustive: never = decision;
			void _exhaustive;
			throw new Error("errors.ssoNotProvisioned");
		}
	}
}

export async function assertPasskeyAllowed(
	db: AppDb,
	email: string,
	onboardingType?: "bootstrap" | "invite",
) {
	if (onboardingType === "bootstrap") {
		return;
	}
	const catalog = await listPublicSsoProviders(db);
	if (isSsoEnforcedForEmail(email, catalog.providers)) {
		throw new Error("errors.ssoRequired");
	}
}
