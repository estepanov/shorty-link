import type { AuthContext } from "../auth/session";
import {
	assertHostnameInScope,
	assertLinkInScope,
	buildDomainScopeForCtx,
	buildLinkScopeForCtx,
} from "../auth/session";
import type { AppDb } from "../db/client";
import { getLinkStats } from "./analytics/stats";
import {
	appendLinkToRoleScopeIfScoped,
	deleteLink,
	getLinkById,
	listDomains,
	listShortLinks,
	normalizeHostname,
	saveLink,
} from "./links";

export type LinkWriteInput = {
	hostname?: string;
	slug?: string;
	targetUrl: string;
	title?: string;
	notes?: string;
	statusCode?: number;
	preserveQueryParams?: boolean;
	isActive?: boolean;
};

export type LinkListInput = {
	search?: string;
	hostname?: string;
	page?: number;
	pageSize?: number;
	active?: "active" | "inactive" | "all";
};

export async function fetchLinkInScope(
	db: AppDb,
	ctx: AuthContext,
	id: string,
) {
	const link = await getLinkById(db, id);
	if (!link) {
		throw new Response("errors.linkMissing", { status: 404 });
	}
	await assertLinkInScope(ctx, link);
	return link;
}

export async function listLinksForCtx(
	db: AppDb,
	ctx: AuthContext,
	input: LinkListInput,
) {
	return listShortLinks(db, input, await buildLinkScopeForCtx(ctx));
}

export async function createLinkForCtx(
	db: AppDb,
	ctx: AuthContext,
	input: LinkWriteInput,
) {
	const targetHost = normalizeHostname(input.hostname);
	if (ctx.domainScope) {
		await assertHostnameInScope(ctx, targetHost);
	} else if (ctx.linkScope) {
		throw new Response("errors.linkScopeRequiresDomain", { status: 403 });
	}

	const id = await saveLink(db, {
		...input,
		createdBy: ctx.user.id,
	});
	await appendLinkToRoleScopeIfScoped(db, ctx.role.id, id);
	return id;
}

export async function updateLinkForCtx(
	db: AppDb,
	ctx: AuthContext,
	id: string,
	input: LinkWriteInput,
) {
	await fetchLinkInScope(db, ctx, id);
	const targetHost = normalizeHostname(input.hostname);
	if (ctx.domainScope) {
		await assertHostnameInScope(ctx, targetHost);
	}
	return saveLink(db, {
		...input,
		id,
		createdBy: ctx.user.id,
	});
}

export async function deleteLinkForCtx(
	db: AppDb,
	ctx: AuthContext,
	id: string,
) {
	await fetchLinkInScope(db, ctx, id);
	await deleteLink(db, id);
	return { ok: true as const, id };
}

export async function getLinkStatsForCtx(
	db: AppDb,
	ctx: AuthContext,
	id: string,
	days?: number,
) {
	const link = await fetchLinkInScope(db, ctx, id);
	const stats = await getLinkStats(db, id, { days });
	return { link, stats };
}

export async function listDomainsForCtx(db: AppDb, ctx: AuthContext) {
	return listDomains(db, buildDomainScopeForCtx(ctx));
}
