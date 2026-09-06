import { Elysia, t } from "elysia";

import type { SsoProviderPatch, SsoProviderWrite } from "@/lib/sso-types";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
	createSsoProvider,
	deleteSsoProvider,
	getAdminSsoProvider,
	listAdminSsoProviders,
	listPublicSsoProviders,
	updateSsoProvider,
} from "../services/sso-providers";
import {
	requirePermissionOrError,
	requireSecurePermissionOrError,
} from "./guards";

const ssoGroupMappingBody = t.Object({
	group: t.String({ minLength: 1 }),
	roleId: t.String({ minLength: 1 }),
});

const oidcConfigBody = t.Object({
	authorizationEndpoint: t.Optional(t.String()),
	discoveryEndpoint: t.Optional(t.String()),
	jwksEndpoint: t.Optional(t.String()),
	skipDiscovery: t.Optional(t.Boolean()),
	tokenEndpoint: t.Optional(t.String()),
	userInfoEndpoint: t.Optional(t.String()),
});

const samlConfigBody = t.Object({
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

const ssoProviderBody = t.Object({
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
	oidcConfig: t.Optional(oidcConfigBody),
	protocol: t.Union([t.Literal("oidc"), t.Literal("saml")]),
	providerId: t.String({ minLength: 1 }),
	samlConfig: t.Optional(samlConfigBody),
});

const ssoProviderPatchBody = t.Object({
	allowIdpInitiated: t.Optional(t.Boolean()),
	clientId: t.Optional(t.String()),
	clientSecret: t.Optional(t.String()),
	defaultRoleId: t.Optional(t.Union([t.String(), t.Null()])),
	displayName: t.Optional(t.String({ minLength: 1 })),
	domain: t.Optional(t.String({ minLength: 1 })),
	enabled: t.Optional(t.Boolean()),
	enforceSso: t.Optional(t.Boolean()),
	groupClaim: t.Optional(t.String()),
	groupRoleMappings: t.Optional(t.Array(ssoGroupMappingBody)),
	issuer: t.Optional(t.String({ minLength: 1 })),
	jitEnabled: t.Optional(t.Boolean()),
	oidcConfig: t.Optional(oidcConfigBody),
	protocol: t.Optional(t.Union([t.Literal("oidc"), t.Literal("saml")])),
	samlConfig: t.Optional(samlConfigBody),
});

export const ssoAdminRoutes = new Elysia({
	name: "sso-admin",
	prefix: "/api/admin",
})
	.get(
		"/sso-providers/public",
		async () => listPublicSsoProviders(createDb()),
		{
			detail: {
				summary: "List enabled SSO providers for sign-in",
				tags: ["SSO"],
			},
		},
	)
	.get(
		"/sso-providers",
		async ({ request }) => {
			await requirePermissionOrError(request, "sso.read");
			return listAdminSsoProviders(createDb(), new URL(request.url).origin);
		},
		{
			detail: { summary: "List SSO providers", tags: ["SSO"] },
		},
	)
	.get(
		"/sso-providers/:providerId/sp-metadata",
		async ({ params, request }) => {
			await requirePermissionOrError(request, "sso.read");
			return createAuth(request).api.spMetadata({
				headers: request.headers,
				query: { providerId: params.providerId },
			});
		},
		{
			detail: { summary: "Get SAML SP metadata", tags: ["SSO"] },
			params: t.Object({ providerId: t.String({ minLength: 1 }) }),
		},
	)
	.get(
		"/sso-providers/:providerId",
		async ({ params, request }) => {
			await requirePermissionOrError(request, "sso.read");
			return getAdminSsoProvider(
				createDb(),
				params.providerId,
				new URL(request.url).origin,
				request,
			);
		},
		{
			detail: { summary: "Get SSO provider", tags: ["SSO"] },
			params: t.Object({ providerId: t.String({ minLength: 1 }) }),
		},
	)
	.post(
		"/sso-providers",
		async ({ body, request }) => {
			const ctx = await requireSecurePermissionOrError(request, "sso.write");
			return createSsoProvider(
				createDb(),
				body as SsoProviderWrite,
				ctx.user.id,
				new URL(request.url).origin,
				request,
			);
		},
		{
			body: ssoProviderBody,
			detail: { summary: "Register SSO provider", tags: ["SSO"] },
		},
	)
	.patch(
		"/sso-providers/:providerId",
		async ({ body, params, request }) => {
			await requireSecurePermissionOrError(request, "sso.write");
			return updateSsoProvider(
				createDb(),
				params.providerId,
				body as SsoProviderPatch,
				new URL(request.url).origin,
				request,
			);
		},
		{
			body: ssoProviderPatchBody,
			detail: { summary: "Update SSO provider", tags: ["SSO"] },
			params: t.Object({ providerId: t.String({ minLength: 1 }) }),
		},
	)
	.delete(
		"/sso-providers/:providerId",
		async ({ params, request }) => {
			await requireSecurePermissionOrError(request, "sso.delete");
			await deleteSsoProvider(createDb(), params.providerId);
			return { ok: true };
		},
		{
			detail: { summary: "Delete SSO provider", tags: ["SSO"] },
			params: t.Object({ providerId: t.String({ minLength: 1 }) }),
		},
	);
