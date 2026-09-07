import type { Static } from "@sinclair/typebox";
import { t } from "elysia";

export const ssoGroupMappingBody = t.Object({
	group: t.String({ minLength: 1 }),
	roleId: t.String({ minLength: 1 }),
});

export const ssoOidcConfigBody = t.Object({
	authorizationEndpoint: t.Optional(t.String()),
	discoveryEndpoint: t.Optional(t.String()),
	jwksEndpoint: t.Optional(t.String()),
	skipDiscovery: t.Optional(t.Boolean()),
	tokenEndpoint: t.Optional(t.String()),
	userInfoEndpoint: t.Optional(t.String()),
});

export const ssoSamlConfigBody = t.Object({
	cert: t.Optional(t.Union([t.String(), t.Array(t.String())])),
	entryPoint: t.Optional(t.String()),
	idpMetadata: t.Optional(
		t.Object({
			cert: t.Optional(t.Union([t.String(), t.Array(t.String())])),
			entityID: t.Optional(t.String()),
			metadata: t.Optional(t.String()),
		}),
	),
	mapping: t.Optional(
		t.Object({
			email: t.Optional(t.String({ minLength: 1 })),
			emailVerified: t.Optional(t.String({ minLength: 1 })),
			name: t.Optional(t.String({ minLength: 1 })),
		}),
	),
	privateKey: t.Optional(t.String()),
});

const ssoProviderCommonBody = {
	allowIdpInitiated: t.Optional(t.Boolean()),
	defaultRoleId: t.Optional(t.Union([t.String(), t.Null()])),
	displayName: t.String({ minLength: 1 }),
	domain: t.String({ minLength: 1 }),
	enabled: t.Optional(t.Boolean()),
	enforceSso: t.Optional(t.Boolean()),
	groupClaim: t.Optional(t.String()),
	groupRoleMappings: t.Optional(t.Array(ssoGroupMappingBody)),
	issuer: t.String({ minLength: 1 }),
	jitEnabled: t.Optional(t.Boolean()),
	providerId: t.String({ minLength: 1 }),
};

const ssoProviderPatchCommonBody = {
	allowIdpInitiated: t.Optional(t.Boolean()),
	defaultRoleId: t.Optional(t.Union([t.String(), t.Null()])),
	displayName: t.Optional(t.String({ minLength: 1 })),
	domain: t.Optional(t.String({ minLength: 1 })),
	enabled: t.Optional(t.Boolean()),
	enforceSso: t.Optional(t.Boolean()),
	groupClaim: t.Optional(t.String()),
	groupRoleMappings: t.Optional(t.Array(ssoGroupMappingBody)),
	issuer: t.Optional(t.String({ minLength: 1 })),
	jitEnabled: t.Optional(t.Boolean()),
};

export const ssoOidcProviderBody = t.Object(
	{
		...ssoProviderCommonBody,
		clientId: t.String({ minLength: 1 }),
		clientSecret: t.String({ minLength: 1 }),
		oidcConfig: t.Optional(ssoOidcConfigBody),
		protocol: t.Literal("oidc"),
	},
	{ additionalProperties: false },
);

export const ssoSamlProviderBody = t.Object(
	{
		...ssoProviderCommonBody,
		protocol: t.Literal("saml"),
		samlConfig: ssoSamlConfigBody,
	},
	{ additionalProperties: false },
);

export const ssoProviderBody = t.Union([
	ssoOidcProviderBody,
	ssoSamlProviderBody,
]);

export const ssoOidcProviderPatchBody = t.Object(
	{
		...ssoProviderPatchCommonBody,
		clientId: t.Optional(t.String({ minLength: 1 })),
		clientSecret: t.Optional(t.String()),
		oidcConfig: t.Optional(ssoOidcConfigBody),
		protocol: t.Literal("oidc"),
	},
	{ additionalProperties: false },
);

export const ssoSamlProviderPatchBody = t.Object(
	{
		...ssoProviderPatchCommonBody,
		protocol: t.Literal("saml"),
		samlConfig: t.Optional(ssoSamlConfigBody),
	},
	{ additionalProperties: false },
);

export const ssoProviderPatchBody = t.Union([
	ssoOidcProviderPatchBody,
	ssoSamlProviderPatchBody,
]);

export type SsoGroupRoleMapping = Static<typeof ssoGroupMappingBody>;
export type SsoOidcWriteConfig = Static<typeof ssoOidcConfigBody>;
export type SsoOidcProviderPatch = Static<typeof ssoOidcProviderPatchBody>;
export type SsoOidcProviderWrite = Static<typeof ssoOidcProviderBody>;
export type SsoProviderPatch = Static<typeof ssoProviderPatchBody>;
export type SsoProviderWrite = Static<typeof ssoProviderBody>;
export type SsoSamlProviderPatch = Static<typeof ssoSamlProviderPatchBody>;
export type SsoSamlProviderWrite = Static<typeof ssoSamlProviderBody>;
export type SsoSamlWriteConfig = Static<typeof ssoSamlConfigBody>;
