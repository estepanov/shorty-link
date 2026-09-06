import {
	deriveSAMLIdentityProviderEntityID,
	discoverOIDCConfig,
	type SAMLConfig,
} from "@better-auth/sso";
import { inArray } from "drizzle-orm";

import type {
	SsoAdminProvider,
	SsoOidcProviderPatch,
	SsoOidcProviderWrite,
	SsoOidcReadConfig,
	SsoProviderPatch,
	SsoProviderWrite,
	SsoSamlProviderPatch,
	SsoSamlProviderWrite,
	SsoSamlReadConfig,
} from "@/lib/sso-types";
import { DEFAULT_SAML_ATTRIBUTE_MAPPING } from "@/lib/sso-types";
import {
	isOidcDiscoveryEndpointAllowed,
	isOidcEndpointAllowed,
} from "../auth/oidc-endpoint-security";
import { getAuthSecret } from "../auth/secret";
import {
	decodeSsoConfigJson,
	encodeSsoConfigJson,
} from "../auth/sso-config-codec";
import { redactSsoConfigJson, ssoConfigHasSecret } from "../auth/sso-secrets";
import type { AppDb } from "../db/client";
import {
	roles,
	SYSTEM_ROLE_OWNER,
	type ssoProvider,
	type ssoProviderSettings,
} from "../db/schema";
import {
	normalizeProtocol,
	parseGroupRoleMappings,
	parseProviderDomains,
	type SsoProtocol,
} from "./sso-admission";

export function callbackUrls(origin: string, providerId: string) {
	return {
		acsUrl: `${origin}/api/auth/sso/saml2/sp/acs/${providerId}`,
		callbackUrl: `${origin}/api/auth/sso/callback/${providerId}`,
		spMetadataUrl: `${origin}/api/admin/sso-providers/${providerId}/sp-metadata`,
	};
}

export function originFromAbsoluteUrl(value: string | null | undefined) {
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

function isUsableHttpUrl(value: unknown): value is string {
	if (typeof value !== "string" || !value.trim()) {
		return false;
	}
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

export function configString(
	record: Record<string, unknown> | null,
	key: string,
): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function configBoolean(
	record: Record<string, unknown> | null,
	key: string,
): boolean | undefined {
	const value = record?.[key];
	return typeof value === "boolean" ? value : undefined;
}

function configCertificate(
	record: Record<string, unknown> | null,
	key: string,
): string | string[] | undefined {
	const value = record?.[key];
	if (typeof value === "string") {
		return value;
	}
	return Array.isArray(value) &&
		value.every((certificate) => typeof certificate === "string")
		? value
		: undefined;
}

function nestedConfig(
	record: Record<string, unknown> | null,
	key: string,
): Record<string, unknown> | null {
	const value = record?.[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function hasCertificate(value: unknown) {
	if (typeof value === "string") {
		return value.trim().length > 0;
	}
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(certificate) =>
				typeof certificate === "string" && certificate.trim().length > 0,
		)
	);
}

function assertOidcEndpoints(
	config: Record<string, unknown>,
	trustedOrigin: string,
) {
	if (
		!isUsableHttpUrl(config.issuer) ||
		!isOidcDiscoveryEndpointAllowed(config.discoveryEndpoint, trustedOrigin) ||
		!isOidcEndpointAllowed(config.authorizationEndpoint, trustedOrigin) ||
		!isOidcEndpointAllowed(config.tokenEndpoint, trustedOrigin) ||
		!isOidcEndpointAllowed(config.jwksEndpoint, trustedOrigin) ||
		(config.userInfoEndpoint !== undefined &&
			!isOidcEndpointAllowed(config.userInfoEndpoint, trustedOrigin))
	) {
		throw new Error("errors.ssoConfigurationInvalid");
	}
}

function assertSamlConfig(config: Record<string, unknown>) {
	const idpMetadata = nestedConfig(config, "idpMetadata");
	const metadata = configString(idpMetadata, "metadata");
	if (metadata?.trim()) {
		try {
			const entityId = deriveSAMLIdentityProviderEntityID(
				config as unknown as SAMLConfig,
			);
			if (!entityId?.trim()) {
				throw new Error("Missing IdP entity ID");
			}
			return;
		} catch {
			throw new Error("errors.ssoSamlMetadataInvalid");
		}
	}
	if (
		!isUsableHttpUrl(config.entryPoint) ||
		!configString(idpMetadata, "entityID")?.trim() ||
		!hasCertificate(idpMetadata?.cert ?? config.cert)
	) {
		throw new Error("errors.ssoConfigurationInvalid");
	}
}

export function settingsFromWrite(
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
	if (jitEnabled && !defaultRoleId?.trim()) {
		throw new Error("errors.ssoConfigurationInvalid");
	}
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

export async function assertRoleReferences(
	db: AppDb,
	input: ReturnType<typeof settingsFromWrite>,
) {
	const referencedRoleIds = new Set(
		[
			input.defaultRoleId,
			...input.groupRoleMappings.map((mapping) => mapping.roleId),
		].filter((roleId): roleId is string => roleId !== null),
	);
	if (referencedRoleIds.size === 0) {
		return;
	}
	const rows = await db
		.select({ id: roles.id })
		.from(roles)
		.where(inArray(roles.id, [...referencedRoleIds]));
	if (rows.length !== referencedRoleIds.size) {
		throw new Error("errors.roleMissing");
	}
}

export async function persistConfigJson(
	json: string | null,
	request?: Request,
): Promise<string | null> {
	if (!json) {
		return null;
	}
	return encodeSsoConfigJson(json, getAuthSecret(request));
}

export async function readConfigJson(
	json: string | null | undefined,
	request?: Request,
): Promise<string | null> {
	if (!json) {
		return null;
	}
	return decodeSsoConfigJson(json, getAuthSecret(request));
}

async function hydrateOidcConfig(
	input: SsoOidcProviderWrite | SsoOidcProviderPatch,
	issuer: string,
) {
	const allowIdpInitiated = input.allowIdpInitiated ?? false;
	const existing = input.oidcConfig;
	const issuerOrigin = originFromAbsoluteUrl(issuer);
	if (!issuerOrigin) {
		throw new Error("errors.ssoConfigurationInvalid");
	}
	if (existing?.skipDiscovery) {
		const config = {
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
			skipDiscovery: true,
			tokenEndpoint: existing.tokenEndpoint,
			userInfoEndpoint: existing.userInfoEndpoint,
		};
		assertOidcEndpoints(config, issuerOrigin);
		return config;
	}

	const discoveryEndpoint =
		existing?.discoveryEndpoint ??
		`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
	if (!isOidcDiscoveryEndpointAllowed(discoveryEndpoint, issuerOrigin)) {
		throw new Error("errors.ssoConfigurationInvalid");
	}
	let hydrated: Awaited<ReturnType<typeof discoverOIDCConfig>>;
	try {
		hydrated = await discoverOIDCConfig({
			existingConfig: {
				authorizationEndpoint: existing?.authorizationEndpoint,
				discoveryEndpoint: existing?.discoveryEndpoint,
				jwksEndpoint: existing?.jwksEndpoint,
				tokenEndpoint: existing?.tokenEndpoint,
				userInfoEndpoint: existing?.userInfoEndpoint,
			},
			isTrustedOrigin: (url) => isOidcEndpointAllowed(url, issuerOrigin),
			issuer,
		});
	} catch {
		throw new Error("errors.ssoDiscoveryFailed");
	}
	const config = {
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
	assertOidcEndpoints(config, issuerOrigin);
	return config;
}

export function parseConfigRecord(
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

export function externalIdentityAuthority(
	protocol: SsoProtocol,
	issuer: string,
	oidcJson: string | null,
	samlJson: string | null,
) {
	switch (protocol) {
		case "oidc": {
			const config = parseConfigRecord(oidcJson);
			return configString(config, "issuer")?.trim() || issuer.trim();
		}
		case "saml": {
			const config = parseConfigRecord(samlJson);
			if (!config) {
				throw new Error("errors.ssoConfigurationInvalid");
			}
			try {
				const entityId = deriveSAMLIdentityProviderEntityID(
					config as unknown as SAMLConfig,
				).trim();
				if (entityId) {
					return entityId;
				}
			} catch {
				// Fall through to the stable configuration error.
			}
			throw new Error("errors.ssoConfigurationInvalid");
		}
		default: {
			const _exhaustive: never = protocol;
			void _exhaustive;
			throw new Error("errors.ssoProtocolInvalid");
		}
	}
}

export async function buildOidcJson(
	input: SsoOidcProviderWrite | SsoOidcProviderPatch,
	issuer: string,
	currentJson: string | null,
) {
	const current = parseConfigRecord(currentJson);
	const clientId = input.clientId ?? configString(current, "clientId") ?? "";
	const clientSecret =
		(input.clientSecret?.trim() ? input.clientSecret : undefined) ??
		configString(current, "clientSecret") ??
		"";
	if (!clientId.trim() || !clientSecret.trim()) {
		throw new Error("errors.ssoConfigurationInvalid");
	}
	const currentSkipDiscovery =
		typeof current?.skipDiscovery === "boolean"
			? current.skipDiscovery
			: undefined;
	const oidcConfig = input.oidcConfig ?? {
		authorizationEndpoint: configString(current, "authorizationEndpoint"),
		discoveryEndpoint: configString(current, "discoveryEndpoint"),
		jwksEndpoint: configString(current, "jwksEndpoint"),
		skipDiscovery: currentSkipDiscovery ?? false,
		tokenEndpoint: configString(current, "tokenEndpoint"),
		userInfoEndpoint: configString(current, "userInfoEndpoint"),
	};
	const hydrated = await hydrateOidcConfig(
		{
			...input,
			allowIdpInitiated:
				input.allowIdpInitiated ??
				(typeof current?.allowIdpInitiated === "boolean"
					? current.allowIdpInitiated
					: false),
			clientId,
			clientSecret,
			oidcConfig,
		},
		issuer,
	);
	return JSON.stringify(hydrated);
}

export async function buildSamlJson(
	input: SsoSamlProviderWrite | SsoSamlProviderPatch,
	issuer: string,
	currentJson: string | null,
) {
	const current = parseConfigRecord(currentJson);
	const currentIdpMetadata = nestedConfig(current, "idpMetadata");
	const currentMapping = nestedConfig(current, "mapping");
	const requestedMapping = input.samlConfig?.mapping;
	const mapping = {
		email:
			requestedMapping?.email?.trim() ||
			configString(currentMapping, "email")?.trim() ||
			DEFAULT_SAML_ATTRIBUTE_MAPPING.email,
		emailVerified:
			requestedMapping?.emailVerified?.trim() ||
			configString(currentMapping, "emailVerified")?.trim() ||
			DEFAULT_SAML_ATTRIBUTE_MAPPING.emailVerified,
		name:
			requestedMapping?.name?.trim() ||
			configString(currentMapping, "name")?.trim() ||
			DEFAULT_SAML_ATTRIBUTE_MAPPING.name,
	};
	const requested = input.samlConfig;
	const existingPrivateKey = configString(current, "privateKey");
	const replacesConnection =
		requested !== undefined &&
		("idpMetadata" in requested ||
			"entryPoint" in requested ||
			"cert" in requested);
	const record: Record<string, unknown> = {
		...(replacesConnection ? {} : (current ?? {})),
		...(requested ?? {}),
		callbackUrl: "/admin",
		idpMetadata: replacesConnection
			? (requested?.idpMetadata ?? {})
			: (currentIdpMetadata ?? {}),
		issuer,
		mapping,
		privateKey:
			(requested?.privateKey?.trim() ? requested.privateKey : undefined) ??
			existingPrivateKey,
	};
	assertSamlConfig(record);
	return JSON.stringify(record);
}

export function toAdminProvider(
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

export function settingsInsertValues(
	input: ReturnType<typeof settingsFromWrite>,
) {
	const timestamp = Date.now();
	return {
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
}

export function toOidcReadConfig(
	json: string | null,
): SsoOidcReadConfig | null {
	const config = redactSsoConfigJson(json);
	if (!config) {
		return null;
	}
	return {
		allowIdpInitiated: configBoolean(config, "allowIdpInitiated"),
		authorizationEndpoint: configString(config, "authorizationEndpoint"),
		clientId: configString(config, "clientId"),
		clientSecret: configString(config, "clientSecret"),
		discoveryEndpoint: configString(config, "discoveryEndpoint"),
		issuer: configString(config, "issuer"),
		jwksEndpoint: configString(config, "jwksEndpoint"),
		pkce: configBoolean(config, "pkce"),
		skipDiscovery: configBoolean(config, "skipDiscovery"),
		tokenEndpoint: configString(config, "tokenEndpoint"),
		tokenEndpointAuthentication: configString(
			config,
			"tokenEndpointAuthentication",
		),
		userInfoEndpoint: configString(config, "userInfoEndpoint"),
	};
}

export function toSamlReadConfig(
	json: string | null,
): SsoSamlReadConfig | null {
	const config = redactSsoConfigJson(json);
	if (!config) {
		return null;
	}
	const idpMetadata = nestedConfig(config, "idpMetadata");
	const mapping = nestedConfig(config, "mapping");
	return {
		callbackUrl: configString(config, "callbackUrl"),
		cert:
			configCertificate(config, "cert") ??
			configCertificate(idpMetadata, "cert"),
		entryPoint: configString(config, "entryPoint"),
		idpMetadata: {
			entityID: configString(idpMetadata, "entityID"),
			metadata: configString(idpMetadata, "metadata"),
		},
		issuer: configString(config, "issuer"),
		mapping: {
			email: configString(mapping, "email"),
			emailVerified: configString(mapping, "emailVerified"),
			name: configString(mapping, "name"),
		},
	};
}
