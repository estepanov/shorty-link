import { sso } from "@better-auth/sso";

import type { AppDb } from "../db/client";
import {
	applySsoAdmission,
	type PreparedSsoAdmission,
	prepareSsoAdmission,
} from "../services/sso-provisioning";

type SsoValidationInput = {
	source: {
		action: string;
		method: string;
		sso?: {
			profile?: Record<string, unknown> | null;
			providerId?: string;
		};
	};
	user: {
		email?: unknown;
		emailVerified?: unknown;
	};
};

type AdmissionState =
	| { status: "empty" }
	| { prepared: PreparedSsoAdmission; status: "prepared" }
	| { status: "consumed" };

function createAdmissionCoordinator(db: AppDb) {
	let state: AdmissionState = { status: "empty" };

	const match = (providerId: string, email?: string) => {
		if (state.status !== "prepared") {
			return null;
		}
		const prepared = state.prepared;
		if (
			prepared.providerId !== providerId ||
			(email !== undefined && prepared.email !== email.trim().toLowerCase())
		) {
			return null;
		}
		return prepared;
	};
	const matchEmail = (email: string) => {
		if (state.status !== "prepared") {
			return null;
		}
		return state.prepared.email === email.trim().toLowerCase()
			? state.prepared
			: null;
	};

	return {
		async prepare(input: SsoValidationInput) {
			if (state.status !== "empty") {
				throw new Error("errors.ssoNotProvisioned");
			}
			const providerId = input.source.sso?.providerId;
			const email =
				typeof input.user.email === "string" ? input.user.email : "";
			if (!providerId) {
				throw new Error("errors.ssoNotProvisioned");
			}
			const prepared = await prepareSsoAdmission(db, {
				email,
				emailVerified: input.user.emailVerified === true,
				profile: input.source.sso?.profile,
				providerId,
			});
			const isNewUser = input.source.action === "create-user";
			const isNewUserDecision =
				prepared.decision.action === "invite" ||
				prepared.decision.action === "jit";
			if (isNewUser !== isNewUserDecision) {
				throw new Error("errors.ssoNotProvisioned");
			}
			state = { prepared, status: "prepared" };
		},
		match,
		matchEmail,
		consume(providerId: string, email: string) {
			const prepared = match(providerId, email);
			if (!prepared) {
				throw new Error("errors.ssoNotProvisioned");
			}
			state = { status: "consumed" };
			return prepared;
		},
	};
}

export function createSsoIntegration(
	db: AppDb,
	options: { allowSamlIdpInitiated: boolean },
) {
	const admission = createAdmissionCoordinator(db);

	return {
		async accountCreateBefore(newAccount: { providerId: string }) {
			const prepared = admission.match(newAccount.providerId);
			if (!prepared) {
				return;
			}
			return {
				data: {
					issuer: `local:${prepared.providerId}`,
				},
			};
		},
		ssoPlugin: sso({
			disableImplicitSignUp: false,
			domainVerification: { enabled: false },
			organizationProvisioning: { disabled: true },
			provisionUserOnEveryLogin: true,
			saml: {
				allowIdpInitiated: options.allowSamlIdpInitiated,
			},
			trustEmailVerified: true,
			provisionUser: async ({ provider, user }) => {
				const prepared = admission.consume(provider.providerId, user.email);
				await applySsoAdmission(db, prepared, user.id);
			},
		}),
		async validateUserInfo(input: SsoValidationInput) {
			if (
				input.source.method !== "sso-oidc" &&
				input.source.method !== "sso-saml"
			) {
				return;
			}
			try {
				await admission.prepare(input);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "errors.ssoNotProvisioned";
				return { error: message, errorDescription: message };
			}
		},
		async userCreateBefore(newUser: { email: string }) {
			const prepared = admission.matchEmail(newUser.email);
			if (!prepared || prepared.decision.action === "sign_in") {
				return;
			}
			return {
				data: {
					invitedBy:
						prepared.decision.action === "invite"
							? prepared.decision.invitedBy
							: null,
					isActive: prepared.decision.action === "jit",
					roleId: prepared.decision.roleId,
				},
			};
		},
	};
}
