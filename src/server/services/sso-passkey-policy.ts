import { isSsoEnforcedForEmail } from "@/lib/sso-catalog";
import type { AppDb } from "../db/client";
import { listPublicSsoProviders } from "./sso-provider-repository";

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
