import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getEncryptionSecret } from "../auth/secret";
import {
	decryptSsoConfigJson,
	encryptSsoConfigJson,
} from "../auth/sso-secrets";
import { type AppDb, createDb } from "../db/client";
import {
	adminInvites,
	SYSTEM_ROLE_OWNER,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../db/schema";
import { now } from "./links";

export const SSO_ADMIN_HEADER = "x-shorty-sso-admin";
export const RESERVED_SSO_PROVIDER_IDS = new Set([
	"apikey",
	"credential",
	"email",
	"passkey",
	"username",
]);

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export type SsoProtocol = "oidc" | "saml";

export type SsoGroupRoleMapping = {
	group: string;
	roleId: string;
};

export type SsoProviderSettingsView = {
	providerId: string;
	enabled: boolean;
	jitEnabled: boolean;
	defaultRoleId: string | null;
	domains: string[];
	groupClaim: string;
	groupRoleMappings: SsoGroupRoleMapping[];
};

export type SsoEnforcementProvider = {
	enabled: boolean;
	enforceSso: boolean;
	domains: string[];
};

export type SsoExistingUser = {
	id: string;
	email: string;
	isActive: boolean;
	roleId: string;
};

export type SsoPendingInvite = {
	email: string;
	roleId: string;
	invitedBy: string | null;
	expiresAt: number;
	token: string;
};

export type SsoAdmissionInput = {
	email: string | null | undefined;
	emailVerified: boolean;
	providerId: string;
	groups: string[];
	existingUser: SsoExistingUser | null;
	pendingInvite: SsoPendingInvite | null;
	settings: SsoProviderSettingsView | null;
	now?: number;
};

export type SsoAdmissionResult =
	| {
			ok: true;
			action: "sign_in";
			userId: string;
			roleId: string;
			roleChanged: boolean;
			error?: undefined;
	  }
	| {
			ok: true;
			action: "invite";
			roleId: string;
			invitedBy: string | null;
			token: string;
			error?: undefined;
	  }
	| {
			ok: true;
			action: "jit";
			roleId: string;
			error?: undefined;
	  }
	| { ok: false; error: string };

function fail(error: string): SsoAdmissionResult {
	return { ok: false, error };
}

export function emailDomain(email: string): string | null {
	const trimmed = email.trim().toLowerCase();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0 || at === trimmed.length - 1) {
		return null;
	}
	return trimmed.slice(at + 1);
}

export function originFromAbsoluteUrl(
	value: string | null | undefined,
): string | null {
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

export function collectIssuerOrigins(
	values: readonly (string | null | undefined)[],
): string[] {
	return [
		...new Set(
			values
				.map((value) => originFromAbsoluteUrl(value))
				.filter((origin): origin is string => Boolean(origin)),
		),
	];
}

export async function readSsoIssuerOriginsFromRequest(
	request?: Request,
): Promise<string[]> {
	if (!request || !["POST", "PUT", "PATCH"].includes(request.method)) {
		return [];
	}
	try {
		const body = (await request.clone().json()) as {
			issuer?: unknown;
			oidcConfig?: {
				authorizationEndpoint?: unknown;
				discoveryEndpoint?: unknown;
				issuer?: unknown;
				jwksEndpoint?: unknown;
				tokenEndpoint?: unknown;
				userInfoEndpoint?: unknown;
			};
			samlConfig?: {
				entryPoint?: unknown;
			};
		};
		return collectIssuerOrigins([
			typeof body.issuer === "string" ? body.issuer : null,
			typeof body.oidcConfig?.issuer === "string"
				? body.oidcConfig.issuer
				: null,
			typeof body.oidcConfig?.discoveryEndpoint === "string"
				? body.oidcConfig.discoveryEndpoint
				: null,
			typeof body.oidcConfig?.authorizationEndpoint === "string"
				? body.oidcConfig.authorizationEndpoint
				: null,
			typeof body.oidcConfig?.tokenEndpoint === "string"
				? body.oidcConfig.tokenEndpoint
				: null,
			typeof body.oidcConfig?.jwksEndpoint === "string"
				? body.oidcConfig.jwksEndpoint
				: null,
			typeof body.oidcConfig?.userInfoEndpoint === "string"
				? body.oidcConfig.userInfoEndpoint
				: null,
			typeof body.samlConfig?.entryPoint === "string"
				? body.samlConfig.entryPoint
				: null,
		]);
	} catch {
		return [];
	}
}

export function parseProviderDomains(domain: string): string[] {
	return domain
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

export function domainMatches(email: string, domains: string[]): boolean {
	const domain = emailDomain(email);
	if (!domain) {
		return false;
	}
	return domains.some((candidate) => candidate === domain);
}

export function isSsoEnforcedForEmail(
	email: string,
	providers: readonly SsoEnforcementProvider[],
): boolean {
	return providers.some(
		(provider) =>
			provider.enabled &&
			provider.enforceSso &&
			domainMatches(email, provider.domains),
	);
}

export function resolveMappedRole(
	groups: readonly string[],
	mappings: readonly SsoGroupRoleMapping[],
): string | null {
	const groupSet = new Set(groups.map((group) => group.trim()));
	for (const mapping of mappings) {
		if (!groupSet.has(mapping.group)) {
			continue;
		}
		if (mapping.roleId === SYSTEM_ROLE_OWNER) {
			continue;
		}
		return mapping.roleId;
	}
	return null;
}

function applyRoleMapping(
	baseRoleId: string,
	groups: readonly string[],
	mappings: readonly SsoGroupRoleMapping[],
): { roleId: string; roleChanged: boolean } {
	if (baseRoleId === SYSTEM_ROLE_OWNER) {
		return { roleId: baseRoleId, roleChanged: false };
	}
	const mapped = resolveMappedRole(groups, mappings);
	if (!mapped || mapped === baseRoleId) {
		return { roleId: baseRoleId, roleChanged: false };
	}
	return { roleId: mapped, roleChanged: true };
}

export function resolveSsoAdmission(
	input: SsoAdmissionInput,
): SsoAdmissionResult {
	const settings = input.settings;
	if (!settings?.enabled) {
		return fail("errors.ssoProviderDisabled");
	}

	const email = input.email?.trim().toLowerCase() ?? "";
	if (!email || !input.emailVerified) {
		return fail("errors.ssoEmailUnverified");
	}

	if (input.existingUser && input.existingUser.isActive === false) {
		return fail("errors.ssoUserDisabled");
	}

	if (input.existingUser) {
		const mapped = applyRoleMapping(
			input.existingUser.roleId,
			input.groups,
			settings.groupRoleMappings,
		);
		return {
			ok: true,
			action: "sign_in",
			userId: input.existingUser.id,
			roleId: mapped.roleId,
			roleChanged: mapped.roleChanged,
		};
	}

	const now = input.now ?? Date.now();
	const invite = input.pendingInvite;
	if (
		invite &&
		invite.email.trim().toLowerCase() === email &&
		invite.expiresAt > now
	) {
		const mapped = applyRoleMapping(
			invite.roleId,
			input.groups,
			settings.groupRoleMappings,
		);
		return {
			ok: true,
			action: "invite",
			roleId: mapped.roleId,
			invitedBy: invite.invitedBy,
			token: invite.token,
		};
	}

	if (settings.jitEnabled) {
		if (settings.defaultRoleId === SYSTEM_ROLE_OWNER) {
			return fail("errors.ssoOwnerRoleForbidden");
		}
		if (!settings.defaultRoleId || !domainMatches(email, settings.domains)) {
			return fail("errors.ssoNotProvisioned");
		}
		const mapped = applyRoleMapping(
			settings.defaultRoleId,
			input.groups,
			settings.groupRoleMappings,
		);
		return {
			ok: true,
			action: "jit",
			roleId: mapped.roleId,
		};
	}

	return fail("errors.ssoNotProvisioned");
}

export function extractIdpGroups(
	claims: Record<string, unknown> | null | undefined,
	groupClaim: string,
): string[] {
	if (!claims) {
		return [];
	}
	const raw = claims[groupClaim];
	if (typeof raw === "string") {
		return raw
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	if (Array.isArray(raw)) {
		return raw
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
}

export function parseGroupRoleMappings(value: string): SsoGroupRoleMapping[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.flatMap((item) => {
			if (
				typeof item === "object" &&
				item !== null &&
				"group" in item &&
				"roleId" in item &&
				typeof item.group === "string" &&
				typeof item.roleId === "string" &&
				item.group.trim() &&
				item.roleId.trim()
			) {
				return [{ group: item.group.trim(), roleId: item.roleId.trim() }];
			}
			return [];
		});
	} catch {
		return [];
	}
}

export function normalizeProviderId(value: string) {
	const providerId = value.trim().toLowerCase();
	if (!PROVIDER_ID_PATTERN.test(providerId)) {
		throw new Error("errors.ssoProviderIdInvalid");
	}
	if (RESERVED_SSO_PROVIDER_IDS.has(providerId)) {
		throw new Error("errors.ssoProviderIdReserved");
	}
	return providerId;
}

export function normalizeProtocol(value: string): SsoProtocol {
	if (value === "oidc" || value === "saml") {
		return value;
	}
	throw new Error("errors.ssoProtocolInvalid");
}

export type SsoPublicProvider = {
	providerId: string;
	displayName: string;
	protocol: SsoProtocol;
	domains: string[];
	enforceSso: boolean;
};

export type SsoAdminProvider = SsoPublicProvider & {
	issuer: string;
	enabled: boolean;
	jitEnabled: boolean;
	defaultRoleId: string | null;
	allowIdpInitiated: boolean;
	groupClaim: string;
	groupRoleMappings: SsoGroupRoleMapping[];
	hasClientSecret: boolean;
	callbackUrl: string;
	acsUrl: string;
	spMetadataUrl: string;
};

function callbackUrls(origin: string, providerId: string) {
	return {
		callbackUrl: `${origin}/api/auth/sso/callback/${providerId}`,
		acsUrl: `${origin}/api/auth/sso/saml2/sp/acs/${providerId}`,
		spMetadataUrl: `${origin}/api/admin/sso-providers/${providerId}/sp-metadata`,
	};
}

function settingsView(
	row: typeof ssoProviderSettings.$inferSelect,
	domain: string,
): SsoProviderSettingsView {
	return {
		providerId: row.providerId,
		enabled: row.enabled,
		jitEnabled: row.jitEnabled,
		defaultRoleId: row.defaultRoleId,
		domains: parseProviderDomains(domain),
		groupClaim: row.groupClaim,
		groupRoleMappings: parseGroupRoleMappings(row.groupRoleMappings),
	};
}

async function encryptConfigField(
	json: string | null | undefined,
	request?: Request,
) {
	if (!json) {
		return json ?? null;
	}
	return encryptSsoConfigJson(json, getEncryptionSecret(request));
}

async function decryptConfigField(
	json: string | null | undefined,
	request?: Request,
) {
	if (!json) {
		return json ?? null;
	}
	try {
		return await decryptSsoConfigJson(json, getEncryptionSecret(request));
	} catch {
		return json;
	}
}

function redactConfig(json: string | null) {
	if (!json) {
		return { present: false };
	}
	try {
		const parsed: unknown = JSON.parse(json);
		if (typeof parsed !== "object" || parsed === null) {
			return { present: true };
		}
		const walk = (value: unknown): unknown => {
			if (Array.isArray(value)) {
				return value.map(walk);
			}
			if (typeof value !== "object" || value === null) {
				return value;
			}
			const next: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(value)) {
				if (
					[
						"clientSecret",
						"privateKey",
						"privateKeyPass",
						"encPrivateKey",
						"encPrivateKeyPass",
					].includes(key) &&
					typeof child === "string" &&
					child
				) {
					next[key] = "********";
				} else {
					next[key] = walk(child);
				}
			}
			return next;
		};
		return { present: true, config: walk(parsed) };
	} catch {
		return { present: true };
	}
}

export async function listPublicSsoProviders(db: AppDb): Promise<{
	providers: SsoPublicProvider[];
	hasEnforcedDomain: boolean;
}> {
	const rows = await db
		.select({
			providerId: ssoProvider.providerId,
			domain: ssoProvider.domain,
			displayName: ssoProviderSettings.displayName,
			protocol: ssoProviderSettings.protocol,
			enabled: ssoProviderSettings.enabled,
			enforceSso: ssoProviderSettings.enforceSso,
		})
		.from(ssoProvider)
		.innerJoin(
			ssoProviderSettings,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(eq(ssoProviderSettings.enabled, true));

	const providers = rows.map((row) => ({
		providerId: row.providerId,
		displayName: row.displayName,
		protocol: normalizeProtocol(row.protocol),
		domains: parseProviderDomains(row.domain),
		enforceSso: row.enforceSso,
	}));

	return {
		providers,
		hasEnforcedDomain: providers.some((provider) => provider.enforceSso),
	};
}

export async function listEnforcementProviders(
	db: AppDb,
): Promise<SsoEnforcementProvider[]> {
	const { providers } = await listPublicSsoProviders(db);
	return providers.map((provider) => ({
		enabled: true,
		enforceSso: provider.enforceSso,
		domains: provider.domains,
	}));
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

	return rows.map(({ provider, settings }) => ({
		...toAdminProvider(provider, settings, origin),
	}));
}

function toAdminProvider(
	provider: typeof ssoProvider.$inferSelect,
	settings: typeof ssoProviderSettings.$inferSelect,
	origin: string,
): SsoAdminProvider {
	const urls = callbackUrls(origin, provider.providerId);
	return {
		providerId: provider.providerId,
		displayName: settings.displayName,
		protocol: normalizeProtocol(settings.protocol),
		domains: parseProviderDomains(provider.domain),
		enforceSso: settings.enforceSso,
		issuer: provider.issuer,
		enabled: settings.enabled,
		jitEnabled: settings.jitEnabled,
		defaultRoleId: settings.defaultRoleId,
		allowIdpInitiated: settings.allowIdpInitiated,
		groupClaim: settings.groupClaim,
		groupRoleMappings: parseGroupRoleMappings(settings.groupRoleMappings),
		hasClientSecret: Boolean(provider.oidcConfig || provider.samlConfig),
		...urls,
	};
}

export async function getAdminSsoProvider(
	db: AppDb,
	providerId: string,
	origin: string,
	request?: Request,
) {
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
	const decryptedOidc = await decryptConfigField(
		row.provider.oidcConfig,
		request,
	);
	const decryptedSaml = await decryptConfigField(
		row.provider.samlConfig,
		request,
	);
	return {
		...toAdminProvider(row.provider, row.settings, origin),
		oidcConfig: redactConfig(decryptedOidc).config ?? null,
		samlConfig: redactConfig(decryptedSaml).config ?? null,
	};
}

export async function loadDefaultSsoProviders(request?: Request) {
	try {
		const db = createDb();
		const rows = await db.select().from(ssoProvider);
		const defaults = [];
		for (const row of rows) {
			const oidcJson = await decryptConfigField(row.oidcConfig, request);
			const samlJson = await decryptConfigField(row.samlConfig, request);
			defaults.push({
				domain: row.domain,
				issuer: row.issuer,
				providerId: row.providerId,
				oidcConfig: oidcJson
					? (JSON.parse(oidcJson) as Record<string, unknown>)
					: undefined,
				samlConfig: samlJson
					? (JSON.parse(samlJson) as Record<string, unknown>)
					: undefined,
			});
		}
		return defaults;
	} catch {
		return [];
	}
}

export async function encryptStoredSsoConfigs(
	db: AppDb,
	providerId: string,
	request?: Request,
) {
	const rows = await db
		.select()
		.from(ssoProvider)
		.where(eq(ssoProvider.providerId, providerId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		return;
	}
	await db
		.update(ssoProvider)
		.set({
			oidcConfig: await encryptConfigField(row.oidcConfig, request),
			samlConfig: await encryptConfigField(row.samlConfig, request),
		})
		.where(eq(ssoProvider.providerId, providerId));
}

export async function upsertSsoSettings(
	db: AppDb,
	input: {
		providerId: string;
		protocol: SsoProtocol;
		displayName: string;
		enabled: boolean;
		jitEnabled: boolean;
		defaultRoleId: string | null;
		enforceSso: boolean;
		allowIdpInitiated: boolean;
		groupClaim: string;
		groupRoleMappings: SsoGroupRoleMapping[];
	},
) {
	if (input.jitEnabled && input.defaultRoleId === SYSTEM_ROLE_OWNER) {
		throw new Error("errors.ssoOwnerRoleForbidden");
	}
	if (
		input.groupRoleMappings.some(
			(mapping) => mapping.roleId === SYSTEM_ROLE_OWNER,
		)
	) {
		throw new Error("errors.ssoOwnerRoleForbidden");
	}
	const timestamp = now();
	const values = {
		providerId: input.providerId,
		protocol: input.protocol,
		displayName: input.displayName,
		enabled: input.enabled,
		jitEnabled: input.jitEnabled,
		defaultRoleId: input.defaultRoleId,
		enforceSso: input.enforceSso,
		allowIdpInitiated: input.allowIdpInitiated,
		groupClaim: input.groupClaim.trim() || "groups",
		groupRoleMappings: JSON.stringify(input.groupRoleMappings),
		createdAt: timestamp,
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
				protocol: values.protocol,
				displayName: values.displayName,
				enabled: values.enabled,
				jitEnabled: values.jitEnabled,
				defaultRoleId: values.defaultRoleId,
				enforceSso: values.enforceSso,
				allowIdpInitiated: values.allowIdpInitiated,
				groupClaim: values.groupClaim,
				groupRoleMappings: values.groupRoleMappings,
				updatedAt: timestamp,
			})
			.where(eq(ssoProviderSettings.providerId, input.providerId));
		return;
	}
	await db.insert(ssoProviderSettings).values(values);
}

export async function deleteSsoProviderRows(db: AppDb, providerId: string) {
	await db
		.delete(ssoProviderSettings)
		.where(eq(ssoProviderSettings.providerId, providerId));
	await db.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId));
}

export async function loadSsoSettingsView(db: AppDb, providerId: string) {
	const rows = await db
		.select({
			settings: ssoProviderSettings,
			domain: ssoProvider.domain,
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
	return settingsView(row.settings, row.domain);
}

export async function findUserByEmail(db: AppDb, email: string) {
	const rows = await db
		.select()
		.from(user)
		.where(eq(user.email, email.trim().toLowerCase()))
		.limit(1);
	return rows[0] ?? null;
}

export async function findPendingInviteByEmail(db: AppDb, email: string) {
	const rows = await db
		.select()
		.from(adminInvites)
		.where(
			and(
				eq(adminInvites.email, email.trim().toLowerCase()),
				isNull(adminInvites.acceptedAt),
			),
		)
		.limit(1);
	const invite = rows[0];
	if (!invite || invite.expiresAt <= now()) {
		return null;
	}
	return invite;
}

export async function applySsoAdmission(
	db: AppDb,
	input: {
		email: string;
		emailVerified: boolean;
		providerId: string;
		groups: string[];
		name: string;
	},
) {
	const settings = await loadSsoSettingsView(db, input.providerId);
	const existing = await findUserByEmail(db, input.email);
	const pendingInvite = await findPendingInviteByEmail(db, input.email);
	const decision = resolveSsoAdmission({
		email: input.email,
		emailVerified: input.emailVerified,
		providerId: input.providerId,
		groups: input.groups,
		existingUser: existing
			? {
					id: existing.id,
					email: existing.email,
					isActive: existing.isActive,
					roleId: existing.roleId,
				}
			: null,
		pendingInvite: pendingInvite
			? {
					email: pendingInvite.email,
					roleId: pendingInvite.roleId,
					invitedBy: pendingInvite.invitedBy,
					expiresAt: pendingInvite.expiresAt,
					token: pendingInvite.token,
				}
			: null,
		settings,
	});

	if (!decision.ok) {
		throw new Error(decision.error);
	}

	if (decision.action === "sign_in") {
		if (decision.roleChanged) {
			await db
				.update(user)
				.set({ roleId: decision.roleId, updatedAt: new Date() })
				.where(eq(user.id, decision.userId));
		}
		return { userId: decision.userId };
	}

	const email = input.email.trim().toLowerCase();
	const timestamp = Math.floor(Date.now() / 1000);
	const id = nanoid();

	if (decision.action === "invite") {
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

export async function assertPasskeyAllowed(
	db: AppDb,
	email: string,
	onboardingType?: "bootstrap" | "invite",
) {
	if (onboardingType === "bootstrap") {
		return;
	}
	const providers = await listEnforcementProviders(db);
	if (isSsoEnforcedForEmail(email, providers)) {
		throw new Error("errors.ssoRequired");
	}
}
