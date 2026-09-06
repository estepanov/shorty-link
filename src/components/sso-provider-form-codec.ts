import type {
	SsoOidcProviderPatch,
	SsoOidcProviderWrite,
	SsoProviderRead,
	SsoSamlProviderPatch,
	SsoSamlProviderWrite,
} from "@/lib/sso-types";
import { DEFAULT_SAML_ATTRIBUTE_MAPPING } from "@/lib/sso-types";

export type SsoFormValues = {
	allowIdpInitiated: boolean;
	authorizationEndpoint: string;
	cert: string;
	clientId: string;
	clientSecret: string;
	defaultRoleId: string;
	discoveryEndpoint: string;
	displayName: string;
	domain: string;
	enabled: boolean;
	enforceSso: boolean;
	entryPoint: string;
	groupClaim: string;
	groupRoleMappings: string;
	idpEntityId: string;
	idpMetadata: string;
	issuer: string;
	jitEnabled: boolean;
	jwksEndpoint: string;
	privateKey: string;
	protocol: "oidc" | "saml";
	providerId: string;
	samlEmailAttribute: string;
	samlEmailVerifiedAttribute: string;
	samlNameAttribute: string;
	skipDiscovery: boolean;
	tokenEndpoint: string;
	userInfoEndpoint: string;
};

export const emptySsoFormValues: SsoFormValues = {
	allowIdpInitiated: false,
	authorizationEndpoint: "",
	cert: "",
	clientId: "",
	clientSecret: "",
	defaultRoleId: "",
	discoveryEndpoint: "",
	displayName: "",
	domain: "",
	enabled: true,
	enforceSso: false,
	entryPoint: "",
	groupClaim: "groups",
	groupRoleMappings: "",
	idpEntityId: "",
	idpMetadata: "",
	issuer: "",
	jitEnabled: false,
	jwksEndpoint: "",
	privateKey: "",
	protocol: "oidc",
	providerId: "",
	samlEmailAttribute: DEFAULT_SAML_ATTRIBUTE_MAPPING.email,
	samlEmailVerifiedAttribute: DEFAULT_SAML_ATTRIBUTE_MAPPING.emailVerified,
	samlNameAttribute: DEFAULT_SAML_ATTRIBUTE_MAPPING.name,
	skipDiscovery: false,
	tokenEndpoint: "",
	userInfoEndpoint: "",
};

function optional(value: string) {
	return value.trim() ? value : undefined;
}

function parseMappings(value: string) {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [group, roleId] = line.split("=").map((part) => part.trim());
			if (!group || !roleId) {
				throw new Error("errors.ssoGroupMappingInvalid");
			}
			return { group, roleId };
		});
}

function commonPayload(value: SsoFormValues) {
	return {
		allowIdpInitiated: value.allowIdpInitiated,
		defaultRoleId: optional(value.defaultRoleId) ?? null,
		displayName: value.displayName,
		domain: value.domain,
		enabled: value.enabled,
		enforceSso: value.enforceSso,
		groupClaim: value.groupClaim,
		groupRoleMappings: parseMappings(value.groupRoleMappings),
		issuer: value.issuer,
		jitEnabled: value.jitEnabled,
	};
}

function oidcConfig(value: SsoFormValues) {
	return {
		authorizationEndpoint: optional(value.authorizationEndpoint),
		discoveryEndpoint: optional(value.discoveryEndpoint),
		jwksEndpoint: optional(value.jwksEndpoint),
		skipDiscovery: value.skipDiscovery,
		tokenEndpoint: optional(value.tokenEndpoint),
		userInfoEndpoint: optional(value.userInfoEndpoint),
	};
}

function samlConfig(value: SsoFormValues) {
	const metadata = optional(value.idpMetadata);
	return {
		cert: metadata ? undefined : optional(value.cert),
		entryPoint: metadata ? undefined : optional(value.entryPoint),
		idpMetadata: metadata
			? { metadata }
			: { entityID: optional(value.idpEntityId) },
		mapping: {
			email: value.samlEmailAttribute,
			emailVerified: value.samlEmailVerifiedAttribute,
			name: value.samlNameAttribute,
		},
		privateKey: optional(value.privateKey),
	};
}

export function toSsoProviderCreate(
	value: SsoFormValues,
): SsoOidcProviderWrite | SsoSamlProviderWrite {
	switch (value.protocol) {
		case "oidc":
			return {
				...commonPayload(value),
				clientId: value.clientId,
				clientSecret: value.clientSecret,
				oidcConfig: oidcConfig(value),
				protocol: "oidc",
				providerId: value.providerId,
			};
		case "saml":
			return {
				...commonPayload(value),
				protocol: "saml",
				providerId: value.providerId,
				samlConfig: samlConfig(value),
			};
		default: {
			const _exhaustive: never = value.protocol;
			void _exhaustive;
			throw new Error("errors.ssoProtocolInvalid");
		}
	}
}

export function toSsoProviderPatch(
	value: SsoFormValues,
	originalProtocol: SsoFormValues["protocol"],
): SsoOidcProviderPatch | SsoSamlProviderPatch {
	switch (originalProtocol) {
		case "oidc":
			return {
				...commonPayload(value),
				clientId: value.clientId,
				clientSecret: optional(value.clientSecret),
				oidcConfig: oidcConfig(value),
				protocol: "oidc",
			};
		case "saml":
			return {
				...commonPayload(value),
				protocol: "saml",
				samlConfig: samlConfig(value),
			};
		default: {
			const _exhaustive: never = originalProtocol;
			void _exhaustive;
			throw new Error("errors.ssoProtocolInvalid");
		}
	}
}

export function ssoProviderToFormValues(
	provider: SsoProviderRead,
): SsoFormValues {
	const certificate = provider.samlConfig?.cert;
	return {
		...emptySsoFormValues,
		allowIdpInitiated: provider.allowIdpInitiated,
		authorizationEndpoint: provider.oidcConfig?.authorizationEndpoint ?? "",
		cert:
			typeof certificate === "string"
				? certificate
				: (certificate?.join("\n\n") ?? ""),
		clientId: provider.oidcConfig?.clientId ?? "",
		defaultRoleId: provider.defaultRoleId ?? "",
		discoveryEndpoint: provider.oidcConfig?.discoveryEndpoint ?? "",
		displayName: provider.displayName,
		domain: provider.domains.join(","),
		enabled: provider.enabled,
		enforceSso: provider.enforceSso,
		entryPoint: provider.samlConfig?.entryPoint ?? "",
		groupClaim: provider.groupClaim,
		groupRoleMappings: provider.groupRoleMappings
			.map((mapping) => `${mapping.group}=${mapping.roleId}`)
			.join("\n"),
		idpEntityId: provider.samlConfig?.idpMetadata?.entityID ?? "",
		idpMetadata: provider.samlConfig?.idpMetadata?.metadata ?? "",
		issuer: provider.issuer,
		jitEnabled: provider.jitEnabled,
		jwksEndpoint: provider.oidcConfig?.jwksEndpoint ?? "",
		protocol: provider.protocol,
		providerId: provider.providerId,
		samlEmailAttribute:
			provider.samlConfig?.mapping?.email ??
			DEFAULT_SAML_ATTRIBUTE_MAPPING.email,
		samlEmailVerifiedAttribute:
			provider.samlConfig?.mapping?.emailVerified ??
			DEFAULT_SAML_ATTRIBUTE_MAPPING.emailVerified,
		samlNameAttribute:
			provider.samlConfig?.mapping?.name ?? DEFAULT_SAML_ATTRIBUTE_MAPPING.name,
		skipDiscovery: provider.oidcConfig?.skipDiscovery ?? false,
		tokenEndpoint: provider.oidcConfig?.tokenEndpoint ?? "",
		userInfoEndpoint: provider.oidcConfig?.userInfoEndpoint ?? "",
	};
}
