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
	entryPoint: t.Optional(t.String()),
	idpMetadata: t.Optional(
		t.Object({
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
});

export const ssoProviderBody = t.Object({
	allowIdpInitiated: t.Optional(t.Boolean()),
	clientId: t.Optional(t.String()),
	clientSecret: t.Optional(t.String()),
	defaultRoleId: t.Optional(t.Union([t.String(), t.Null()])),
	displayName: t.String({ minLength: 1 }),
	domain: t.String({ minLength: 1 }),
	enabled: t.Optional(t.Boolean()),
	enforceSso: t.Optional(t.Boolean()),
	groupClaim: t.Optional(t.String()),
	groupRoleMappings: t.Optional(t.Array(ssoGroupMappingBody)),
	issuer: t.String({ minLength: 1 }),
	jitEnabled: t.Optional(t.Boolean()),
	oidcConfig: t.Optional(ssoOidcConfigBody),
	protocol: t.Union([t.Literal("oidc"), t.Literal("saml")]),
	providerId: t.String({ minLength: 1 }),
	samlConfig: t.Optional(ssoSamlConfigBody),
});

export const ssoProviderPatchBody = t.Partial(
	t.Omit(ssoProviderBody, ["providerId"]),
);

export type SsoGroupRoleMapping = Static<typeof ssoGroupMappingBody>;
export type SsoOidcWriteConfig = Static<typeof ssoOidcConfigBody>;
export type SsoProviderPatch = Static<typeof ssoProviderPatchBody>;
export type SsoProviderWrite = Static<typeof ssoProviderBody>;
export type SsoSamlWriteConfig = Static<typeof ssoSamlConfigBody>;
