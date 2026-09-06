import { SYSTEM_ROLE_OWNER } from "../db/schema";

export type SsoProtocol = "oidc" | "saml";

export type SsoGroupRoleMapping = {
	group: string;
	roleId: string;
};

export type SsoProviderSettingsView = {
	providerId: string;
	enabled: boolean;
	jitEnabled: boolean;
	defaultRoleId: string | null;
	domains: string[];
	groupClaim: string;
	groupRoleMappings: SsoGroupRoleMapping[];
};

export type SsoEnforcementProvider = {
	enabled: boolean;
	enforceSso: boolean;
	domains: string[];
};

export type SsoExistingUser = {
	id: string;
	email: string;
	isActive: boolean;
	roleId: string;
};

export type SsoPendingInvite = {
	email: string;
	roleId: string;
	invitedBy: string | null;
	expiresAt: number;
	token: string;
};

export type SsoAdmissionInput = {
	email: string | null | undefined;
	emailVerified: boolean;
	providerId: string;
	groups: string[];
	existingUser: SsoExistingUser | null;
	pendingInvite: SsoPendingInvite | null;
	settings: SsoProviderSettingsView | null;
	now?: number;
};

export type SsoAdmissionResult =
	| {
			ok: true;
			action: "sign_in";
			userId: string;
			roleId: string;
			roleChanged: boolean;
			error?: undefined;
	  }
	| {
			ok: true;
			action: "invite";
			roleId: string;
			invitedBy: string | null;
			token: string;
			error?: undefined;
	  }
	| {
			ok: true;
			action: "jit";
			roleId: string;
			error?: undefined;
	  }
	| { ok: false; error: string };

function fail(error: string): SsoAdmissionResult {
	return { ok: false, error };
}

export function emailDomain(email: string): string | null {
	const trimmed = email.trim().toLowerCase();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0 || at === trimmed.length - 1) {
		return null;
	}
	return trimmed.slice(at + 1);
}

export function parseProviderDomains(domain: string): string[] {
	return domain
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

export function domainMatches(email: string, domains: string[]): boolean {
	const domain = emailDomain(email);
	if (!domain) {
		return false;
	}
	return domains.some((candidate) => candidate === domain);
}

export function isSsoEnforcedForEmail(
	email: string,
	providers: readonly SsoEnforcementProvider[],
): boolean {
	return providers.some(
		(provider) =>
			provider.enabled &&
			provider.enforceSso &&
			domainMatches(email, provider.domains),
	);
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
): { roleId: string; roleChanged: boolean } {
	if (baseRoleId === SYSTEM_ROLE_OWNER) {
		return { roleId: baseRoleId, roleChanged: false };
	}
	const mapped = resolveMappedRole(groups, mappings);
	if (!mapped || mapped === baseRoleId) {
		return { roleId: baseRoleId, roleChanged: false };
	}
	return { roleId: mapped, roleChanged: true };
}

export function resolveSsoAdmission(
	input: SsoAdmissionInput,
): SsoAdmissionResult {
	const settings = input.settings;
	if (!settings || !settings.enabled) {
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
			ok: true,
			action: "sign_in",
			userId: input.existingUser.id,
			roleId: mapped.roleId,
			roleChanged: mapped.roleChanged,
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
			ok: true,
			action: "invite",
			roleId: mapped.roleId,
			invitedBy: invite.invitedBy,
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
			ok: true,
			action: "jit",
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
