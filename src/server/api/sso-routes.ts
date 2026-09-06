import { Elysia, t } from "elysia";

import { ssoProviderBody, ssoProviderPatchBody } from "@/lib/sso-contract";
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
				body,
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
				body,
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
