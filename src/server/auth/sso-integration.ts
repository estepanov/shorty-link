import { sso } from "@better-auth/sso";
import type { BetterAuthOptions } from "better-auth";

import type { AppDb } from "../db/client";
import {
	applySsoAdmission,
	type PreparedSsoAdmission,
	prepareSsoAdmission,
} from "../services/sso-provisioning";

type UserOptions = NonNullable<BetterAuthOptions["user"]>;
type SsoValidationInput = Parameters<
	NonNullable<UserOptions["validateUserInfo"]>
>[0];
type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type AccountCreateBeforeInput = Parameters<
	NonNullable<
		NonNullable<NonNullable<DatabaseHooks["account"]>["create"]>["before"]
	>
>[0];
type UserCreateBeforeInput = Parameters<
	NonNullable<
		NonNullable<NonNullable<DatabaseHooks["user"]>["create"]>["before"]
	>
>[0];

type AdmissionState =
	| { status: "empty" }
	| { prepared: PreparedSsoAdmission; status: "prepared" }
	| { status: "consumed" };

function createAdmissionCoordinator(db: AppDb) {
	const states = new Map<string, AdmissionState>();
	let activeKey: string | null = null;
	const keyFor = (providerId: string, email: string) =>
		`${providerId}\0${email.trim().toLowerCase()}`;

	const match = (providerId: string, email?: string) => {
		const key = email === undefined ? activeKey : keyFor(providerId, email);
		if (!key) {
			return null;
		}
		const state = states.get(key);
		if (!state || state.status !== "prepared") {
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
		if (!activeKey) {
			return null;
		}
		const state = states.get(activeKey);
		if (!state || state.status !== "prepared") {
			return null;
		}
		return state.prepared.email === email.trim().toLowerCase()
			? state.prepared
			: null;
	};

	return {
		async prepare(input: SsoValidationInput) {
			const providerId = input.source.sso?.providerId;
			const email =
				typeof input.user.email === "string" ? input.user.email : "";
			if (!providerId) {
				throw new Error("errors.ssoNotProvisioned");
			}
			const key = keyFor(providerId, email);
			const existingState = states.get(key);
			if (existingState?.status === "prepared") {
				return;
			}
			if (existingState || (activeKey !== null && activeKey !== key)) {
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
			activeKey = key;
			states.set(key, { prepared, status: "prepared" });
		},
		match,
		matchEmail,
		consume(providerId: string, email: string) {
			const prepared = match(providerId, email);
			if (!prepared) {
				throw new Error("errors.ssoNotProvisioned");
			}
			const key = keyFor(providerId, email);
			states.set(key, { status: "consumed" });
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
		async accountCreateBefore(newAccount: AccountCreateBeforeInput) {
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
		async userCreateBefore(newUser: UserCreateBeforeInput) {
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
