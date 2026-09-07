import type { Permission } from "@/lib/permissions";
import {
	getSession,
	requireAuth,
	requirePermissionContext,
	requireSecurePermission,
} from "../auth/session";

export async function requireAuthOrError(request: Request) {
	try {
		return await requireAuth(request);
	} catch (error) {
		if (error instanceof Response) {
			throw error;
		}
		throw new Response("errors.unauthorized", { status: 401 });
	}
}

export async function requirePermissionOrError(
	request: Request,
	permission: Permission | Permission[],
) {
	try {
		return await requirePermissionContext(request, permission);
	} catch (error) {
		if (error instanceof Response) {
			throw error;
		}
		throw new Response("errors.unauthorized", { status: 401 });
	}
}

export async function requireSecurePermissionOrError(
	request: Request,
	permission: Permission | Permission[],
) {
	try {
		return await requireSecurePermission(request, permission);
	} catch (error) {
		if (error instanceof Response) {
			throw error;
		}
		throw new Response("errors.unauthorized", { status: 401 });
	}
}

export async function requireSignedOutInviteRequest(request: Request) {
	if (await getSession(request)) {
		throw new Response("errors.inviteRequiresSignOut", { status: 403 });
	}
}
