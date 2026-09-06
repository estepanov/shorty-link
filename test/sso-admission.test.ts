import { describe, expect, it } from "vitest";

import { emailDomain, isSsoEnforcedForEmail } from "../src/lib/sso-catalog";
import { SYSTEM_ROLE_ADMIN, SYSTEM_ROLE_OWNER } from "../src/server/db/schema";
import { resolveSsoAdmission } from "../src/server/services/sso-admission";

const settings = {
	providerId: "okta",
	enabled: true,
	jitEnabled: false,
	defaultRoleId: SYSTEM_ROLE_ADMIN,
	domains: ["acme.com"],
	groupClaim: "groups",
	groupRoleMappings: [] as Array<{ group: string; roleId: string }>,
};

describe("sso admission", () => {
	it("extracts the email domain", () => {
		expect(emailDomain("Ada@Acme.com")).toBe("acme.com");
		expect(emailDomain("not-an-email")).toBeNull();
	});

	it("enforces SSO only for enabled providers matching the domain", () => {
		expect(
			isSsoEnforcedForEmail("user@acme.com", [
				{ enabled: true, enforceSso: true, domains: ["acme.com"] },
			]),
		).toBe(true);
		expect(
			isSsoEnforcedForEmail("user@acme.com", [
				{ enabled: false, enforceSso: true, domains: ["acme.com"] },
			]),
		).toBe(false);
		expect(
			isSsoEnforcedForEmail("user@other.com", [
				{ enabled: true, enforceSso: true, domains: ["acme.com"] },
			]),
		).toBe(false);
	});

	it("rejects missing providers, unverified email, and disabled users", () => {
		expect(
			resolveSsoAdmission({
				email: "user@acme.com",
				emailVerified: true,
				providerId: "okta",
				groups: [],
				existingUser: null,
				pendingInvite: null,
				settings: null,
			}).error,
		).toBe("errors.ssoProviderDisabled");

		expect(
			resolveSsoAdmission({
				email: "user@acme.com",
				emailVerified: false,
				providerId: "okta",
				groups: [],
				existingUser: null,
				pendingInvite: null,
				settings,
			}).error,
		).toBe("errors.ssoEmailUnverified");

		expect(
			resolveSsoAdmission({
				email: "user@acme.com",
				emailVerified: true,
				providerId: "okta",
				groups: [],
				existingUser: {
					id: "u1",
					email: "user@acme.com",
					isActive: false,
					roleId: SYSTEM_ROLE_ADMIN,
				},
				pendingInvite: null,
				settings,
			}).error,
		).toBe("errors.ssoUserDisabled");
	});

	it("signs in an existing active user without changing role when groups do not match", () => {
		const decision = resolveSsoAdmission({
			email: "user@acme.com",
			emailVerified: true,
			providerId: "okta",
			groups: ["contractors"],
			existingUser: {
				id: "u1",
				email: "user@acme.com",
				isActive: true,
				roleId: SYSTEM_ROLE_ADMIN,
			},
			pendingInvite: null,
			settings: {
				...settings,
				groupRoleMappings: [{ group: "eng", roleId: "custom-role" }],
			},
		});
		expect(decision).toEqual({
			ok: true,
			action: "sign_in",
			userId: "u1",
			roleId: SYSTEM_ROLE_ADMIN,
			roleChanged: false,
		});
	});

	it("maps the first matching IdP group onto a non-owner role", () => {
		const decision = resolveSsoAdmission({
			email: "user@acme.com",
			emailVerified: true,
			providerId: "okta",
			groups: ["eng", "admins"],
			existingUser: {
				id: "u1",
				email: "user@acme.com",
				isActive: true,
				roleId: SYSTEM_ROLE_ADMIN,
			},
			pendingInvite: null,
			settings: {
				...settings,
				groupRoleMappings: [
					{ group: "eng", roleId: "engineer" },
					{ group: "admins", roleId: SYSTEM_ROLE_ADMIN },
				],
			},
		});
		expect(decision.ok).toBe(true);
		if (decision.ok && decision.action === "sign_in") {
			expect(decision.roleId).toBe("engineer");
			expect(decision.roleChanged).toBe(true);
		}
	});

	it("never maps groups onto system_owner and never demotes an owner", () => {
		const mappedOwner = resolveSsoAdmission({
			email: "user@acme.com",
			emailVerified: true,
			providerId: "okta",
			groups: ["owners"],
			existingUser: {
				id: "u1",
				email: "user@acme.com",
				isActive: true,
				roleId: SYSTEM_ROLE_ADMIN,
			},
			pendingInvite: null,
			settings: {
				...settings,
				groupRoleMappings: [{ group: "owners", roleId: SYSTEM_ROLE_OWNER }],
			},
		});
		expect(mappedOwner.ok).toBe(true);
		if (mappedOwner.ok && mappedOwner.action === "sign_in") {
			expect(mappedOwner.roleId).toBe(SYSTEM_ROLE_ADMIN);
			expect(mappedOwner.roleChanged).toBe(false);
		}

		const owner = resolveSsoAdmission({
			email: "owner@acme.com",
			emailVerified: true,
			providerId: "okta",
			groups: ["eng"],
			existingUser: {
				id: "owner",
				email: "owner@acme.com",
				isActive: true,
				roleId: SYSTEM_ROLE_OWNER,
			},
			pendingInvite: null,
			settings: {
				...settings,
				groupRoleMappings: [{ group: "eng", roleId: "engineer" }],
			},
		});
		expect(owner.ok).toBe(true);
		if (owner.ok && owner.action === "sign_in") {
			expect(owner.roleId).toBe(SYSTEM_ROLE_OWNER);
			expect(owner.roleChanged).toBe(false);
		}
	});

	it("claims a pending invite for a new user and lets groups override the invite role", () => {
		const invited = resolveSsoAdmission({
			email: "new@acme.com",
			emailVerified: true,
			providerId: "okta",
			groups: [],
			existingUser: null,
			pendingInvite: {
				email: "new@acme.com",
				roleId: SYSTEM_ROLE_ADMIN,
				invitedBy: "owner",
				expiresAt: Date.now() + 60_000,
				token: "invite-token",
			},
			settings,
		});
		expect(invited).toMatchObject({
			ok: true,
			action: "invite",
			roleId: SYSTEM_ROLE_ADMIN,
			token: "invite-token",
		});

		const remapped = resolveSsoAdmission({
			email: "new@acme.com",
			emailVerified: true,
			providerId: "okta",
			groups: ["eng"],
			existingUser: null,
			pendingInvite: {
				email: "new@acme.com",
				roleId: SYSTEM_ROLE_ADMIN,
				invitedBy: "owner",
				expiresAt: Date.now() + 60_000,
				token: "invite-token",
			},
			settings: {
				...settings,
				groupRoleMappings: [{ group: "eng", roleId: "engineer" }],
			},
		});
		expect(remapped).toMatchObject({
			ok: true,
			action: "invite",
			roleId: "engineer",
		});
	});

	it("JIT-provisions a matching domain and rejects owner JIT and domain mismatch", () => {
		const jit = resolveSsoAdmission({
			email: "new@acme.com",
			emailVerified: true,
			providerId: "okta",
			groups: [],
			existingUser: null,
			pendingInvite: null,
			settings: { ...settings, jitEnabled: true },
		});
		expect(jit).toEqual({
			ok: true,
			action: "jit",
			roleId: SYSTEM_ROLE_ADMIN,
		});

		expect(
			resolveSsoAdmission({
				email: "new@other.com",
				emailVerified: true,
				providerId: "okta",
				groups: [],
				existingUser: null,
				pendingInvite: null,
				settings: { ...settings, jitEnabled: true },
			}).error,
		).toBe("errors.ssoNotProvisioned");

		expect(
			resolveSsoAdmission({
				email: "new@acme.com",
				emailVerified: true,
				providerId: "okta",
				groups: [],
				existingUser: null,
				pendingInvite: null,
				settings: {
					...settings,
					jitEnabled: true,
					defaultRoleId: SYSTEM_ROLE_OWNER,
				},
			}).error,
		).toBe("errors.ssoOwnerRoleForbidden");
	});
});
