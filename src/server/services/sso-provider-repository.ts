import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { SsoPublicCatalog } from "@/lib/sso-catalog";
import type {
	SsoProviderPatch,
	SsoProviderRead,
	SsoProviderWrite,
} from "@/lib/sso-types";
import type { AppDb } from "../db/client";
import { account, ssoProvider, ssoProviderSettings } from "../db/schema";
import {
	normalizeProtocol,
	normalizeProviderId,
	parseProviderDomains,
} from "./sso-admission";
import {
	assertRoleReferences,
	buildOidcJson,
	buildSamlJson,
	configString,
	externalIdentityAuthority,
	originFromAbsoluteUrl,
	parseConfigRecord,
	persistConfigJson,
	readConfigJson,
	settingsFromWrite,
	settingsInsertValues,
	toAdminProvider,
	toOidcReadConfig,
	toSamlReadConfig,
} from "./sso-provider-config";

const OIDC_TRUSTED_URL_KEYS = [
	"authorizationEndpoint",
	"discoveryEndpoint",
	"issuer",
	"jwksEndpoint",
	"tokenEndpoint",
	"userInfoEndpoint",
] as const;

export async function loadOidcProviderTrustedOrigins(
	db: AppDb,
	providerId: string,
) {
	const rows = await db
		.select({
			issuer: ssoProvider.issuer,
			oidcConfig: ssoProvider.oidcConfig,
		})
		.from(ssoProvider)
		.innerJoin(
			ssoProviderSettings,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(
			and(
				eq(ssoProvider.providerId, providerId),
				eq(ssoProviderSettings.enabled, true),
				eq(ssoProviderSettings.protocol, "oidc"),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) {
		return [];
	}

	let config: Record<string, unknown> | null;
	try {
		config = parseConfigRecord(row.oidcConfig);
	} catch {
		return [];
	}
	if (!config) {
		return [];
	}
	const endpointOrigins = OIDC_TRUSTED_URL_KEYS.map((key) =>
		originFromAbsoluteUrl(
			key === "issuer"
				? configString(config, key) || row.issuer
				: configString(config, key),
		),
	).filter((origin): origin is string => origin !== null);
	return [...new Set(endpointOrigins)];
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
		oidcConfig: toOidcReadConfig(oidcJson),
		samlConfig: toSamlReadConfig(samlJson),
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
	const settings = settingsFromWrite(providerId, protocol, {
		...input,
		providerId,
	});
	await assertRoleReferences(db, settings);

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

	const providerInsert = db.insert(ssoProvider).values({
		domain: input.domain,
		id: nanoid(),
		issuer: input.issuer,
		oidcConfig: oidcJson,
		organizationId: null,
		providerId,
		samlConfig: samlJson,
		userId: actorUserId,
	});
	const settingsInsert = db
		.insert(ssoProviderSettings)
		.values(settingsInsertValues(settings));
	await db.batch([providerInsert, settingsInsert]);

	return getAdminSsoProvider(db, providerId, origin, request);
}

export async function updateSsoProvider(
	db: AppDb,
	providerId: string,
	input: SsoProviderPatch,
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
	const currentOidc = await readConfigJson(row.provider.oidcConfig, request);
	const currentSaml = await readConfigJson(row.provider.samlConfig, request);
	const current = toAdminProvider(
		row.provider,
		row.settings,
		origin,
		currentOidc,
		currentSaml,
	);
	const protocol = input.protocol
		? normalizeProtocol(input.protocol)
		: current.protocol;
	if (protocol !== current.protocol) {
		throw new Error("errors.ssoProtocolImmutable");
	}
	const issuer = input.issuer ?? current.issuer;
	if (
		protocol === "oidc" &&
		input.issuer !== undefined &&
		input.issuer.trim() !==
			externalIdentityAuthority(
				protocol,
				row.provider.issuer,
				currentOidc,
				currentSaml,
			)
	) {
		const linkedAccounts = await db
			.select({ id: account.id })
			.from(account)
			.where(eq(account.providerId, providerId))
			.limit(1);
		if (linkedAccounts[0]) {
			throw new Error("errors.ssoIdentityBoundaryImmutable");
		}
	}
	const settings = settingsFromWrite(providerId, protocol, input, current);
	await assertRoleReferences(db, settings);
	const nextOidc =
		protocol === "oidc"
			? await buildOidcJson(input, issuer, currentOidc)
			: null;
	const nextSaml =
		protocol === "saml"
			? await buildSamlJson(input, issuer, currentSaml)
			: null;
	const identityBoundaryChanged =
		externalIdentityAuthority(
			protocol,
			row.provider.issuer,
			currentOidc,
			currentSaml,
		) !== externalIdentityAuthority(protocol, issuer, nextOidc, nextSaml);
	const oidcJson = await persistConfigJson(nextOidc, request);
	const samlJson = await persistConfigJson(nextSaml, request);

	const updatedAt = Math.max(Date.now(), row.settings.updatedAt + 1);
	const noLinkedAccounts = identityBoundaryChanged
		? sql`not exists (
				select 1
				from ${account}
				where ${account.providerId} = ${providerId}
			)`
		: undefined;
	const providerUpdate = db
		.update(ssoProvider)
		.set({
			domain: input.domain ?? row.provider.domain,
			issuer,
			oidcConfig: oidcJson,
			samlConfig: samlJson,
		})
		.where(
			and(
				eq(ssoProvider.providerId, providerId),
				sql`exists (
					select 1
					from ${ssoProviderSettings}
					where ${ssoProviderSettings.providerId} = ${providerId}
						and ${ssoProviderSettings.updatedAt} = ${row.settings.updatedAt}
				)`,
				noLinkedAccounts,
			),
		);
	const settingsUpdate = db
		.update(ssoProviderSettings)
		.set({
			allowIdpInitiated: settings.allowIdpInitiated,
			defaultRoleId: settings.defaultRoleId,
			displayName: settings.displayName,
			enabled: settings.enabled,
			enforceSso: settings.enforceSso,
			groupClaim: settings.groupClaim.trim() || "groups",
			groupRoleMappings: JSON.stringify(settings.groupRoleMappings),
			jitEnabled: settings.jitEnabled,
			protocol: settings.protocol,
			updatedAt,
		})
		.where(
			and(
				eq(ssoProviderSettings.providerId, providerId),
				eq(ssoProviderSettings.updatedAt, row.settings.updatedAt),
				noLinkedAccounts,
			),
		);
	const providerState = db
		.select({
			linkedAccountCount: sql<number>`(
				select count(*)
				from ${account}
				where ${account.providerId} = ${providerId}
			)`,
			providerId: ssoProvider.providerId,
		})
		.from(ssoProvider)
		.innerJoin(
			ssoProviderSettings,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(eq(ssoProvider.providerId, providerId))
		.limit(1);
	const [providerResult, settingsResult, state] = await db.batch([
		providerUpdate,
		settingsUpdate,
		providerState,
	]);
	if (providerResult.meta.changes !== 1 || settingsResult.meta.changes !== 1) {
		if (state.length === 0) {
			throw new Error("errors.ssoProviderMissing");
		}
		if (identityBoundaryChanged && state[0].linkedAccountCount > 0) {
			throw new Error("errors.ssoIdentityBoundaryImmutable");
		}
		throw new Error("errors.ssoProviderConflict");
	}
	return getAdminSsoProvider(db, providerId, origin, request);
}

export async function deleteSsoProvider(db: AppDb, providerId: string) {
	await db.batch([
		db.delete(account).where(eq(account.providerId, providerId)),
		db.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId)),
	]);
}
