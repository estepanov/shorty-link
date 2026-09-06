import { and, desc, eq, gt, isNull } from "drizzle-orm";

import type { AppDb } from "../db/client";
import {
	adminInvites,
	roles,
	ssoProvider,
	ssoProviderSettings,
	user,
} from "../db/schema";
import {
	extractIdpGroups,
	parseGroupRoleMappings,
	parseProviderDomains,
	resolveSsoAdmission,
	type SsoAdmissionResult,
	type SsoProviderSettingsView,
} from "./sso-admission";

export type PreparedSsoAdmission = {
	decision: Exclude<SsoAdmissionResult, { ok: false }>;
	email: string;
	providerId: string;
};

export type SsoAdmissionInput = {
	email: string;
	emailVerified: boolean;
	profile?: Record<string, unknown> | null;
	providerId: string;
};

export async function prepareSsoAdmission(
	db: AppDb,
	input: SsoAdmissionInput,
): Promise<PreparedSsoAdmission> {
	const email = input.email.trim().toLowerCase();
	const admissionTime = Date.now();
	const settingsQuery = db
		.select({
			domain: ssoProvider.domain,
			settings: ssoProviderSettings,
		})
		.from(ssoProviderSettings)
		.innerJoin(
			ssoProvider,
			eq(ssoProvider.providerId, ssoProviderSettings.providerId),
		)
		.where(eq(ssoProviderSettings.providerId, input.providerId))
		.limit(1);
	const existingUserQuery = db
		.select()
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	const inviteQuery = db
		.select()
		.from(adminInvites)
		.where(
			and(
				eq(adminInvites.email, email),
				isNull(adminInvites.acceptedAt),
				gt(adminInvites.expiresAt, admissionTime),
			),
		)
		.orderBy(desc(adminInvites.createdAt), desc(adminInvites.id))
		.limit(1);
	const roleQuery = db.select({ id: roles.id }).from(roles);
	const [settingsRows, existingRows, inviteRows, roleRows] = await db.batch([
		settingsQuery,
		existingUserQuery,
		inviteQuery,
		roleQuery,
	]);

	const settingsRow = settingsRows[0];
	const parsedMappings = settingsRow
		? parseGroupRoleMappings(settingsRow.settings.groupRoleMappings)
		: [];
	const existingRoleIds = new Set(roleRows.map(({ id }) => id));
	const settings: SsoProviderSettingsView | null = settingsRow
		? {
				defaultRoleId: settingsRow.settings.defaultRoleId,
				domains: parseProviderDomains(settingsRow.domain),
				enabled: settingsRow.settings.enabled,
				groupClaim: settingsRow.settings.groupClaim,
				groupRoleMappings: parsedMappings.filter(({ roleId }) =>
					existingRoleIds.has(roleId),
				),
				jitEnabled: settingsRow.settings.jitEnabled,
				providerId: settingsRow.settings.providerId,
			}
		: null;
	const existing = existingRows[0] ?? null;
	const invite = inviteRows[0] ?? null;
	const groups = extractIdpGroups(
		input.profile,
		settings?.groupClaim ?? "groups",
	);
	const decision = resolveSsoAdmission({
		email: input.email,
		emailVerified: input.emailVerified,
		existingUser: existing
			? {
					email: existing.email,
					id: existing.id,
					isActive: existing.isActive,
					roleId: existing.roleId,
				}
			: null,
		groups,
		pendingInvite: invite
			? {
					email: invite.email,
					expiresAt: invite.expiresAt,
					invitedBy: invite.invitedBy,
					roleId: invite.roleId,
					token: invite.token,
				}
			: null,
		providerId: input.providerId,
		settings,
	});

	if (!decision.ok) {
		throw new Error(decision.error);
	}

	return {
		decision,
		email,
		providerId: input.providerId,
	};
}

export async function applySsoAdmission(
	db: AppDb,
	prepared: PreparedSsoAdmission,
	authenticatedUserId: string,
) {
	const { decision, email } = prepared;

	switch (decision.action) {
		case "sign_in": {
			if (decision.userId !== authenticatedUserId) {
				throw new Error("errors.ssoNotProvisioned");
			}
			if (decision.roleChanged) {
				await db
					.update(user)
					.set({ roleId: decision.roleId, updatedAt: new Date() })
					.where(eq(user.id, decision.userId));
			}
			return { userId: decision.userId };
		}
		case "invite": {
			const acceptedAt = Date.now();
			const claimId = authenticatedUserId;
			const claimStatement = db.$client
				.prepare(`
				update "admin_invite"
				set "accepted_at" = ?, "sso_claim_id" = ?, "role_id" = ?
				where "token" = ?
					and "email" = ?
					and "accepted_at" is null
					and "expires_at" > ?
			`)
				.bind(
					acceptedAt,
					claimId,
					decision.roleId,
					decision.token,
					email,
					acceptedAt,
				);
			const removeStagedUser = async () => {
				const removeStatement = db.$client
					.prepare(`
						delete from "user"
						where "id" = ? and "email" = ? and "is_active" = 0
					`)
					.bind(authenticatedUserId, email);
				await removeStatement.run();
			};
			try {
				const claimed = await claimStatement.run();
				// D1 includes the invite row and the user row updated by the trigger.
				if (claimed.meta.changes !== 2) {
					throw new Error("errors.ssoNotProvisioned");
				}
			} catch (error) {
				await removeStagedUser();
				throw error;
			}
			return { userId: authenticatedUserId };
		}
		case "jit": {
			const activated = await db.$client
				.prepare(`
					update "user"
					set "role_id" = ?, "is_active" = 1, "updated_at" = ?
					where "id" = ? and "email" = ?
				`)
				.bind(
					decision.roleId,
					Math.floor(Date.now() / 1000),
					authenticatedUserId,
					email,
				)
				.run();
			if (activated.meta.changes !== 1) {
				throw new Error("errors.ssoNotProvisioned");
			}
			return { userId: authenticatedUserId };
		}
		default: {
			const _exhaustive: never = decision;
			void _exhaustive;
			throw new Error("errors.ssoNotProvisioned");
		}
	}
}
