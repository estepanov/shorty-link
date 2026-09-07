import { and, eq } from "drizzle-orm";

import type { AppDb } from "../db/client";
import { ssoProviderSettings } from "../db/schema";

const SAML_ACS_PATH =
	/^\/api\/auth\/sso\/saml2\/sp\/acs\/([a-z0-9][a-z0-9-]*)$/;

export async function allowsSamlIdpInitiatedForRequest(
	request: Request,
	db: AppDb,
): Promise<boolean> {
	if (request.method !== "GET" && request.method !== "POST") {
		return false;
	}
	const match = SAML_ACS_PATH.exec(new URL(request.url).pathname);
	const providerId = match?.[1];
	if (!providerId) {
		return false;
	}
	const rows = await db
		.select({ allowIdpInitiated: ssoProviderSettings.allowIdpInitiated })
		.from(ssoProviderSettings)
		.where(
			and(
				eq(ssoProviderSettings.providerId, providerId),
				eq(ssoProviderSettings.protocol, "saml"),
				eq(ssoProviderSettings.enabled, true),
			),
		)
		.limit(1);
	return rows[0]?.allowIdpInitiated === true;
}
