import { domainMatches, emailDomain } from "@/lib/sso-catalog";
import type { SsoGroupRoleMapping, SsoProtocol } from "@/lib/sso-types";
import { SYSTEM_ROLE_OWNER } from "../db/schema";

export type { SsoGroupRoleMapping, SsoProtocol };

export type SsoProviderSettingsView = {
	defaultRoleId: string | null;
	domains: string[];
	enabled: boolean;
	groupClaim: string;
	groupRoleMappings: SsoGroupRoleMapping[];
	jitEnabled: boolean;
	providerId: string;
};

export type SsoExistingUser = {
	email: string;
	id: string;
	isActive: boolean;
	roleId: string;
};

export type SsoPendingInvite = {
	email: string;
	expiresAt: number;
	invitedBy: string | null;
	roleId: string;
	token: string;
};

export type SsoAdmissionInput = {
	email: string | null | undefined;
	emailVerified: boolean;
	existingUser: SsoExistingUser | null;
	groups: string[];
	now?: number;
	pendingInvite: SsoPendingInvite | null;
	providerId: string;
	settings: SsoProviderSettingsView | null;
};

export type SsoAdmissionResult =
	| {
			action: "sign_in";
			error?: undefined;
			ok: true;
			roleChanged: boolean;
			roleId: string;
			userId: string;
	  }
	| {
			action: "invite";
			error?: undefined;
			invitedBy: string | null;
			ok: true;
			roleId: string;
			token: string;
	  }
	| {
			action: "jit";
			error?: undefined;
			ok: true;
			roleId: string;
	  }
	| { error: string; ok: false };

export const RESERVED_SSO_PROVIDER_IDS = new Set([
	"apikey",
	"credential",
	"email",
	"passkey",
	"username",
]);

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function fail(error: string): SsoAdmissionResult {
	return { error, ok: false };
}

export function parseProviderDomains(domain: string): string[] {
	return domain
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

export function resolveMappedRole(
	groups: readonly string[],
	mappings: readonly SsoGroupRoleMapping[],
): string | null {
	const groupSet = new Set(groups.map((group) => group.trim()));
	for (const mapping of mappings) {
		if (!groupSet.has(mapping.group)) {
			continue;
		}
		if (mapping.roleId === SYSTEM_ROLE_OWNER) {
			continue;
		}
		return mapping.roleId;
	}
	return null;
}

function applyRoleMapping(
	baseRoleId: string,
	groups: readonly string[],
	mappings: readonly SsoGroupRoleMapping[],
): { roleChanged: boolean; roleId: string } {
	if (baseRoleId === SYSTEM_ROLE_OWNER) {
		return { roleChanged: false, roleId: baseRoleId };
	}
	const mapped = resolveMappedRole(groups, mappings);
	if (!mapped || mapped === baseRoleId) {
		return { roleChanged: false, roleId: baseRoleId };
	}
	return { roleChanged: true, roleId: mapped };
}

export function resolveSsoAdmission(
	input: SsoAdmissionInput,
): SsoAdmissionResult {
	const settings = input.settings;
	if (!settings?.enabled) {
		return fail("errors.ssoProviderDisabled");
	}

	const email = input.email?.trim().toLowerCase() ?? "";
	if (!email || !input.emailVerified) {
		return fail("errors.ssoEmailUnverified");
	}

	if (input.existingUser && input.existingUser.isActive === false) {
		return fail("errors.ssoUserDisabled");
	}

	if (input.existingUser) {
		const mapped = applyRoleMapping(
			input.existingUser.roleId,
			input.groups,
			settings.groupRoleMappings,
		);
		return {
			action: "sign_in",
			ok: true,
			roleChanged: mapped.roleChanged,
			roleId: mapped.roleId,
			userId: input.existingUser.id,
		};
	}

	const now = input.now ?? Date.now();
	const invite = input.pendingInvite;
	if (
		invite &&
		invite.email.trim().toLowerCase() === email &&
		invite.expiresAt > now
	) {
		const mapped = applyRoleMapping(
			invite.roleId,
			input.groups,
			settings.groupRoleMappings,
		);
		return {
			action: "invite",
			invitedBy: invite.invitedBy,
			ok: true,
			roleId: mapped.roleId,
			token: invite.token,
		};
	}

	if (settings.jitEnabled) {
		if (settings.defaultRoleId === SYSTEM_ROLE_OWNER) {
			return fail("errors.ssoOwnerRoleForbidden");
		}
		if (!settings.defaultRoleId || !domainMatches(email, settings.domains)) {
			return fail("errors.ssoNotProvisioned");
		}
		const mapped = applyRoleMapping(
			settings.defaultRoleId,
			input.groups,
			settings.groupRoleMappings,
		);
		return {
			action: "jit",
			ok: true,
			roleId: mapped.roleId,
		};
	}

	return fail("errors.ssoNotProvisioned");
}

export function extractIdpGroups(
	claims: Record<string, unknown> | null | undefined,
	groupClaim: string,
): string[] {
	if (!claims) {
		return [];
	}
	const raw = claims[groupClaim];
	if (typeof raw === "string") {
		return raw
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	if (Array.isArray(raw)) {
		return raw
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
}

export function parseGroupRoleMappings(value: string): SsoGroupRoleMapping[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.flatMap((item) => {
			if (
				typeof item === "object" &&
				item !== null &&
				"group" in item &&
				"roleId" in item &&
				typeof item.group === "string" &&
				typeof item.roleId === "string" &&
				item.group.trim() &&
				item.roleId.trim()
			) {
				return [{ group: item.group.trim(), roleId: item.roleId.trim() }];
			}
			return [];
		});
	} catch {
		return [];
	}
}

export function normalizeProviderId(value: string) {
	const providerId = value.trim().toLowerCase();
	if (!PROVIDER_ID_PATTERN.test(providerId)) {
		throw new Error("errors.ssoProviderIdInvalid");
	}
	if (RESERVED_SSO_PROVIDER_IDS.has(providerId)) {
		throw new Error("errors.ssoProviderIdReserved");
	}
	return providerId;
}

export function normalizeProtocol(value: string): SsoProtocol {
	if (value === "oidc" || value === "saml") {
		return value;
	}
	throw new Error("errors.ssoProtocolInvalid");
}

export { domainMatches, emailDomain };
