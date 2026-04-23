import { eq } from "drizzle-orm";

import { createDb } from "../db/client";
import { user } from "../db/schema";
import { isAdminRole } from "../services/links";
import { createAuth } from "./auth";

export async function getSession(request: Request) {
	return createAuth(request).api.getSession({
		headers: request.headers,
	});
}

export async function requireAdmin(request: Request) {
	const session = await getSession(request);

	if (!session) {
		throw new Response("errors.unauthorized", { status: 401 });
	}

	const db = createDb();
	const rows = await db
		.select({ id: user.id, role: user.role, isActive: user.isActive })
		.from(user)
		.where(eq(user.id, session.user.id))
		.limit(1);

	if (!isAdminRole(rows[0]?.role) || rows[0]?.isActive === false) {
		throw new Response("errors.forbidden", { status: 403 });
	}

	return session;
}
