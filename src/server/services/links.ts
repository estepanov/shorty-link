import {
	type AnyColumn,
	and,
	count,
	desc,
	eq,
	gt,
	gte,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";

import {
	isRedirectStatusCode,
	normalizeRedirectStatusCode,
	type RedirectStatusCode,
} from "@/lib/redirect-status";
import type { AppDb } from "../db/client";
import {
	adminInvites,
	DEFAULT_HOSTNAME,
	managedDomains,
	redirectEvents,
	shortLinks,
	user,
} from "../db/schema";

const slugAlphabet = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 7);

export { DEFAULT_HOSTNAME };

export function now() {
	return Date.now();
}

function escapeLikePattern(value: string) {
	return `%${value
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_")}%`;
}

function likeEscaped(column: AnyColumn, pattern: string) {
	return sql`${column} like ${pattern} escape '\\'`;
}

export function isAdminRole(role: string | null | undefined) {
	return (role ?? "")
		.split(",")
		.map((value) => value.trim())
		.includes("admin");
}

export function normalizeHostname(value?: string | null) {
	if (!value?.trim()) {
		return DEFAULT_HOSTNAME;
	}

	let normalized = value.trim().toLowerCase();

	try {
		normalized = normalized.includes("://")
			? new URL(normalized).hostname
			: new URL(`https://${normalized}`).hostname;
	} catch {
		throw new Error("errors.invalidHostname");
	}

	if (!normalized || normalized.includes(" ")) {
		throw new Error("errors.invalidHostname");
	}

	return normalized;
}

export function normalizeTargetUrl(value: string) {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("errors.targetRequired");
	}

	try {
		const url = trimmed.includes("://")
			? new URL(trimmed)
			: new URL(`https://${trimmed}`);

		if (!["http:", "https:"].includes(url.protocol)) {
			throw new Error("errors.httpOnly");
		}

		return url.toString();
	} catch {
		throw new Error("errors.invalidTarget");
	}
}

export function normalizeSlug(value: string) {
	const trimmed = value.trim().toLowerCase();
	const slug = trimmed
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-_]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	if (!slug) {
		throw new Error("errors.slugRequired");
	}

	if (slug.length > 64) {
		throw new Error("errors.slugTooLong");
	}

	return slug;
}

export function suggestSlugFromUrl(targetUrl: string) {
	const url = new URL(normalizeTargetUrl(targetUrl));
	const pathBits = url.pathname.split("/").filter(Boolean);
	const source = pathBits.at(-1) || url.hostname.replace(/\./g, "-");
	const suggestion = source
		.toLowerCase()
		.replace(/\.[a-z]+$/i, "")
		.replace(/[^a-z0-9-_]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	return suggestion || slugAlphabet();
}

export function buildInviteUrl(origin: string, token: string) {
	return new URL(`/admin/invite/${token}`, origin).toString();
}

export function buildRedirectTarget(
	targetUrl: string,
	requestUrl: string,
	preserveQueryParams: boolean,
) {
	const destination = new URL(normalizeTargetUrl(targetUrl));

	if (!preserveQueryParams) {
		return destination.toString();
	}

	const incoming = new URL(requestUrl);

	for (const [key, value] of incoming.searchParams.entries()) {
		if (!destination.searchParams.has(key)) {
			destination.searchParams.append(key, value);
		}
	}

	return destination.toString();
}

const ANALYTICS_SAFE_QUERY_KEYS = new Set([
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
]);

export function buildAnalyticsTarget(
	targetUrl: string,
	requestUrl: string,
	preserveQueryParams: boolean,
) {
	const destination = new URL(normalizeTargetUrl(targetUrl));

	if (!preserveQueryParams) {
		return destination.toString();
	}

	const incoming = new URL(requestUrl);

	for (const [key, value] of incoming.searchParams.entries()) {
		if (
			ANALYTICS_SAFE_QUERY_KEYS.has(key.toLowerCase()) &&
			!destination.searchParams.has(key)
		) {
			destination.searchParams.append(key, value);
		}
	}

	return destination.toString();
}

export async function ensureUniqueSlug(
	db: AppDb,
	hostname: string,
	desiredSlug?: string,
	excludeId?: string,
) {
	const baseSlug = desiredSlug ? normalizeSlug(desiredSlug) : slugAlphabet();
	let candidate = baseSlug;

	for (let attempt = 0; attempt < 10; attempt += 1) {
		const existing = await db
			.select({ id: shortLinks.id })
			.from(shortLinks)
			.where(
				and(eq(shortLinks.hostname, hostname), eq(shortLinks.slug, candidate)),
			)
			.limit(1);

		if (!existing.length || existing[0]?.id === excludeId) {
			return candidate;
		}

		candidate = `${baseSlug}-${slugAlphabet(4)}`;
	}

	return `${baseSlug}-${nanoid(6).toLowerCase()}`;
}

export async function getBootstrapState(db: AppDb) {
	const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(user);

	return {
		hasUsers: Number(totalUsers) > 0,
		canBootstrap: Number(totalUsers) === 0,
	};
}

export async function getDashboardData(db: AppDb) {
	const [domains, links, invites, events, counts] = await Promise.all([
		db
			.select()
			.from(managedDomains)
			.orderBy(desc(managedDomains.createdAt))
			.limit(10),
		db.select().from(shortLinks).orderBy(desc(shortLinks.createdAt)).limit(10),
		db
			.select()
			.from(adminInvites)
			.where(
				and(isNull(adminInvites.acceptedAt), gt(adminInvites.expiresAt, now())),
			)
			.orderBy(desc(adminInvites.createdAt))
			.limit(10),
		db
			.select()
			.from(redirectEvents)
			.orderBy(desc(redirectEvents.createdAt))
			.limit(10),
		Promise.all([
			db.select({ total: count() }).from(shortLinks),
			db.select({ total: count() }).from(redirectEvents),
			db.select({ total: count() }).from(managedDomains),
			db
				.select({ total: count() })
				.from(adminInvites)
				.where(
					and(
						isNull(adminInvites.acceptedAt),
						gt(adminInvites.expiresAt, now()),
					),
				),
		]),
	]);

	return {
		domains,
		links,
		invites,
		events,
		summary: {
			links: Number(counts[0][0]?.total ?? 0),
			redirects: Number(counts[1][0]?.total ?? 0),
			domains: Number(counts[2][0]?.total ?? 0),
			invites: Number(counts[3][0]?.total ?? 0),
		},
	};
}

export async function listDomains(db: AppDb) {
	return db.select().from(managedDomains).orderBy(managedDomains.hostname);
}

export async function getDomainById(db: AppDb, id: string) {
	const domains = await db
		.select()
		.from(managedDomains)
		.where(eq(managedDomains.id, id))
		.limit(1);

	return domains[0] ?? null;
}

export async function getLinkById(db: AppDb, id: string) {
	const links = await db
		.select()
		.from(shortLinks)
		.where(eq(shortLinks.id, id))
		.limit(1);

	return links[0] ?? null;
}

export async function listShortLinks(
	db: AppDb,
	input: {
		active?: "active" | "inactive" | "all";
		hostname?: string;
		page?: number;
		pageSize?: number;
		search?: string;
		statusCode?: RedirectStatusCode | "all";
	},
) {
	const page = Math.max(1, Math.floor(input.page ?? 1));
	const pageSize = Math.max(1, Math.min(Math.floor(input.pageSize ?? 25), 100));
	const offset = (page - 1) * pageSize;
	const filters = [];
	const search = input.search?.trim();

	if (search) {
		const pattern = escapeLikePattern(search);
		filters.push(
			or(
				likeEscaped(shortLinks.id, pattern),
				likeEscaped(shortLinks.hostname, pattern),
				likeEscaped(shortLinks.slug, pattern),
				likeEscaped(shortLinks.targetUrl, pattern),
				likeEscaped(shortLinks.title, pattern),
				likeEscaped(shortLinks.notes, pattern),
			),
		);
	}

	if (input.hostname && input.hostname !== "all") {
		filters.push(eq(shortLinks.hostname, normalizeHostname(input.hostname)));
	}

	if (input.active === "active") {
		filters.push(eq(shortLinks.isActive, true));
	} else if (input.active === "inactive") {
		filters.push(eq(shortLinks.isActive, false));
	}

	if (
		typeof input.statusCode === "number" &&
		isRedirectStatusCode(input.statusCode)
	) {
		filters.push(eq(shortLinks.statusCode, input.statusCode));
	}

	const where = filters.length ? and(...filters) : undefined;
	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				createdAt: shortLinks.createdAt,
				hitCount: shortLinks.hitCount,
				hostname: shortLinks.hostname,
				id: shortLinks.id,
				isActive: shortLinks.isActive,
				lastClickAt: shortLinks.lastClickAt,
				notes: shortLinks.notes,
				preserveQueryParams: shortLinks.preserveQueryParams,
				slug: shortLinks.slug,
				statusCode: shortLinks.statusCode,
				targetUrl: shortLinks.targetUrl,
				title: shortLinks.title,
				updatedAt: shortLinks.updatedAt,
			})
			.from(shortLinks)
			.where(where)
			.orderBy(desc(shortLinks.createdAt))
			.limit(pageSize)
			.offset(offset),
		db.select({ total: count() }).from(shortLinks).where(where),
	]);

	return {
		items: rows,
		page,
		pageSize,
		total: Number(total ?? 0),
		totalPages: Math.max(1, Math.ceil(Number(total ?? 0) / pageSize)),
	};
}

export async function saveDomain(
	db: AppDb,
	input: {
		id?: string;
		hostname: string;
		label?: string;
		isPrimary?: boolean;
		isActive?: boolean;
		createdBy?: string;
	},
) {
	const timestamp = now();
	const hostname = normalizeHostname(input.hostname);
	const existing = await db
		.select({ id: managedDomains.id })
		.from(managedDomains)
		.where(eq(managedDomains.hostname, hostname))
		.limit(1);

	if (existing.length && existing[0]?.id !== input.id) {
		throw new Error("errors.hostnameTaken");
	}

	if (input.isPrimary) {
		await db
			.update(managedDomains)
			.set({ isPrimary: false })
			.where(eq(managedDomains.isPrimary, true));
	}

	if (input.id) {
		const current = await db
			.select({ hostname: managedDomains.hostname })
			.from(managedDomains)
			.where(eq(managedDomains.id, input.id))
			.limit(1);

		if (current[0] && current[0].hostname !== hostname) {
			const [{ totalLinks }] = await db
				.select({ totalLinks: count() })
				.from(shortLinks)
				.where(eq(shortLinks.hostname, current[0].hostname));

			if (Number(totalLinks) > 0) {
				throw new Error("errors.domainRenameHasLinks");
			}
		}

		await db
			.update(managedDomains)
			.set({
				hostname,
				label: input.label?.trim() || null,
				isPrimary: input.isPrimary ?? false,
				isActive: input.isActive ?? true,
			})
			.where(eq(managedDomains.id, input.id));

		return input.id;
	}

	const id = nanoid();
	await db.insert(managedDomains).values({
		id,
		hostname,
		label: input.label?.trim() || null,
		isPrimary: input.isPrimary ?? false,
		isActive: input.isActive ?? true,
		createdBy: input.createdBy ?? null,
		createdAt: timestamp,
	});

	return id;
}

export async function deleteDomain(db: AppDb, id: string) {
	const existing = await db
		.select({ hostname: managedDomains.hostname })
		.from(managedDomains)
		.where(eq(managedDomains.id, id))
		.limit(1);

	const [existingDomain] = existing;
	if (!existingDomain) {
		return;
	}

	const [{ totalLinks }] = await db
		.select({ totalLinks: count() })
		.from(shortLinks)
		.where(eq(shortLinks.hostname, existingDomain.hostname));

	if (Number(totalLinks) > 0) {
		throw new Error("errors.domainHasLinks");
	}

	await db.delete(managedDomains).where(eq(managedDomains.id, id));
}

export async function saveLink(
	db: AppDb,
	input: {
		id?: string;
		hostname?: string;
		slug?: string;
		targetUrl: string;
		title?: string;
		notes?: string;
		statusCode?: number;
		preserveQueryParams?: boolean;
		isActive?: boolean;
		createdBy?: string;
	},
) {
	const timestamp = now();
	const hostname = normalizeHostname(input.hostname);
	const targetUrl = normalizeTargetUrl(input.targetUrl);
	const slug = await ensureUniqueSlug(
		db,
		hostname,
		input.slug?.trim() ? input.slug : suggestSlugFromUrl(targetUrl),
		input.id,
	);
	const statusCode = normalizeRedirectStatusCode(input.statusCode);

	if (input.id) {
		const existing = await db
			.select({ preserveQueryParams: shortLinks.preserveQueryParams })
			.from(shortLinks)
			.where(eq(shortLinks.id, input.id))
			.limit(1);

		if (!existing[0]) {
			throw new Error("errors.linkMissing");
		}

		await db
			.update(shortLinks)
			.set({
				hostname,
				slug,
				targetUrl,
				title: input.title?.trim() || null,
				notes: input.notes?.trim() || null,
				statusCode,
				preserveQueryParams:
					input.preserveQueryParams ?? existing[0].preserveQueryParams,
				isActive: input.isActive ?? true,
				updatedAt: timestamp,
			})
			.where(eq(shortLinks.id, input.id));

		return input.id;
	}

	const id = nanoid();
	await db.insert(shortLinks).values({
		id,
		hostname,
		slug,
		targetUrl,
		title: input.title?.trim() || null,
		notes: input.notes?.trim() || null,
		statusCode,
		preserveQueryParams: input.preserveQueryParams ?? false,
		isActive: input.isActive ?? true,
		hitCount: 0,
		createdBy: input.createdBy ?? null,
		createdAt: timestamp,
		updatedAt: timestamp,
	});

	return id;
}

export async function deleteLink(db: AppDb, id: string) {
	await db.delete(shortLinks).where(eq(shortLinks.id, id));
}

const UTM_DIMENSIONS = [
	"utmSource",
	"utmMedium",
	"utmCampaign",
	"utmTerm",
	"utmContent",
] as const;

export type UtmDimension = (typeof UTM_DIMENSIONS)[number];

function startOfUtcDay(timestamp: number) {
	const date = new Date(timestamp);
	date.setUTCHours(0, 0, 0, 0);
	return date.getTime();
}

export async function getLinkStats(
	db: AppDb,
	linkId: string,
	options?: { days?: number; recentLimit?: number; breakdownLimit?: number },
) {
	const days = Math.max(1, Math.min(options?.days ?? 30, 180));
	const recentLimit = Math.max(1, Math.min(options?.recentLimit ?? 20, 100));
	const breakdownLimit = Math.max(
		1,
		Math.min(options?.breakdownLimit ?? 10, 50),
	);
	const windowStart = startOfUtcDay(now() - (days - 1) * 24 * 60 * 60 * 1000);

	const linkColumn = eq(redirectEvents.linkId, linkId);
	const windowFilter = and(
		linkColumn,
		gte(redirectEvents.createdAt, windowStart),
	);
	const dayExpr = sql<number>`(${redirectEvents.createdAt} / 86400000) * 86400000`;

	const totalsQuery = db
		.select({ total: count() })
		.from(redirectEvents)
		.where(linkColumn);

	const windowTotalsQuery = db
		.select({ total: count() })
		.from(redirectEvents)
		.where(windowFilter);

	const histogramQuery = db
		.select({
			day: dayExpr.as("day"),
			total: count(),
		})
		.from(redirectEvents)
		.where(windowFilter)
		.groupBy(dayExpr)
		.orderBy(dayExpr);

	const columnByDimension = {
		utmSource: redirectEvents.utmSource,
		utmMedium: redirectEvents.utmMedium,
		utmCampaign: redirectEvents.utmCampaign,
		utmTerm: redirectEvents.utmTerm,
		utmContent: redirectEvents.utmContent,
	} as const;

	const breakdownsQuery = Promise.all(
		UTM_DIMENSIONS.map(async (dimension) => {
			const column = columnByDimension[dimension];
			const rows = await db
				.select({ value: column, total: count() })
				.from(redirectEvents)
				.where(and(windowFilter, isNotNull(column)))
				.groupBy(column)
				.orderBy(desc(count()))
				.limit(breakdownLimit);

			const items = rows.map((row) => ({
				value: row.value ?? null,
				total: Number(row.total ?? 0),
			}));

			return [dimension, items] as const;
		}),
	);

	const recentEventsQuery = db
		.select({
			id: redirectEvents.id,
			createdAt: redirectEvents.createdAt,
			country: redirectEvents.country,
			referer: redirectEvents.referer,
			utmSource: redirectEvents.utmSource,
			utmMedium: redirectEvents.utmMedium,
			utmCampaign: redirectEvents.utmCampaign,
			utmTerm: redirectEvents.utmTerm,
			utmContent: redirectEvents.utmContent,
		})
		.from(redirectEvents)
		.where(linkColumn)
		.orderBy(desc(redirectEvents.createdAt))
		.limit(recentLimit);

	const [
		[totalsRow],
		[windowRow],
		histogramRows,
		breakdownEntries,
		recentEvents,
	] = await Promise.all([
		totalsQuery,
		windowTotalsQuery,
		histogramQuery,
		breakdownsQuery,
		recentEventsQuery,
	]);

	const histogramMap = new Map<number, number>(
		histogramRows.map((row) => [Number(row.day), Number(row.total)]),
	);
	const histogram: Array<{ day: number; total: number }> = [];
	for (let index = 0; index < days; index += 1) {
		const day = windowStart + index * 24 * 60 * 60 * 1000;
		histogram.push({ day, total: histogramMap.get(day) ?? 0 });
	}

	const breakdowns = Object.fromEntries(breakdownEntries) as Record<
		UtmDimension,
		Array<{ value: string | null; total: number }>
	>;

	return {
		totals: {
			allTime: Number(totalsRow?.total ?? 0),
			window: Number(windowRow?.total ?? 0),
		},
		windowDays: days,
		windowStart,
		histogram,
		breakdowns,
		recentEvents,
	};
}

export async function createInvite(
	db: AppDb,
	input: {
		email: string;
		invitedBy?: string;
		expiresInDays?: number;
		role?: string;
	},
) {
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error("errors.invalidEmail");
	}

	const expiresInDays = Math.max(1, Math.min(input.expiresInDays ?? 7, 30));
	const timestamp = now();
	const token = nanoid(32);
	const id = nanoid();

	await db.insert(adminInvites).values({
		id,
		email,
		token,
		role: input.role ?? "admin",
		invitedBy: input.invitedBy ?? null,
		expiresAt: timestamp + expiresInDays * 24 * 60 * 60 * 1000,
		acceptedAt: null,
		createdAt: timestamp,
	});

	return { id, token };
}

export async function getInviteByToken(db: AppDb, token: string) {
	const invites = await db
		.select()
		.from(adminInvites)
		.where(
			and(
				eq(adminInvites.token, token),
				isNull(adminInvites.acceptedAt),
				gt(adminInvites.expiresAt, now()),
			),
		)
		.limit(1);

	return invites[0] ?? null;
}

export async function acceptInvite(db: AppDb, token: string) {
	await db
		.update(adminInvites)
		.set({ acceptedAt: now() })
		.where(eq(adminInvites.token, token));
}

export async function resolveRedirect(
	db: AppDb,
	input: {
		hostname: string;
		slug: string;
	},
) {
	const normalizedHost = normalizeHostname(input.hostname);
	const normalizedSlug = normalizeSlug(input.slug);

	const exact = await db
		.select()
		.from(shortLinks)
		.where(
			and(
				eq(shortLinks.hostname, normalizedHost),
				eq(shortLinks.slug, normalizedSlug),
				eq(shortLinks.isActive, true),
			),
		)
		.limit(1);

	if (exact[0]) {
		return exact[0];
	}

	if (normalizedHost === DEFAULT_HOSTNAME) {
		return null;
	}

	const fallback = await db
		.select()
		.from(shortLinks)
		.where(
			and(
				eq(shortLinks.hostname, DEFAULT_HOSTNAME),
				eq(shortLinks.slug, normalizedSlug),
				eq(shortLinks.isActive, true),
			),
		)
		.limit(1);

	return fallback[0] ?? null;
}

export function extractUtmParams(requestUrl: string) {
	try {
		const params = new URL(requestUrl).searchParams;
		const read = (key: string) => {
			const value = params.get(key)?.trim();
			return value ? value.slice(0, 256) : null;
		};

		return {
			utmSource: read("utm_source"),
			utmMedium: read("utm_medium"),
			utmCampaign: read("utm_campaign"),
			utmTerm: read("utm_term"),
			utmContent: read("utm_content"),
		};
	} catch {
		return {
			utmSource: null,
			utmMedium: null,
			utmCampaign: null,
			utmTerm: null,
			utmContent: null,
		};
	}
}

function truncateStoredText(
	value: string | null | undefined,
	maxLength: number,
) {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
}

export async function recordRedirectEvent(
	db: AppDb,
	input: {
		linkId: string;
		hostname: string;
		slug: string;
		targetUrl: string;
		statusCode: number;
		country?: string | null;
		city?: string | null;
		colo?: string | null;
		referer?: string | null;
		userAgent?: string | null;
		ipHash?: string | null;
		utmSource?: string | null;
		utmMedium?: string | null;
		utmCampaign?: string | null;
		utmTerm?: string | null;
		utmContent?: string | null;
	},
) {
	const timestamp = now();

	await db.insert(redirectEvents).values({
		id: nanoid(),
		linkId: input.linkId,
		hostname: input.hostname,
		slug: input.slug,
		targetUrl: input.targetUrl,
		statusCode: input.statusCode,
		country: truncateStoredText(input.country, 32),
		city: truncateStoredText(input.city, 128),
		colo: truncateStoredText(input.colo, 32),
		referer: truncateStoredText(input.referer, 2048),
		userAgent: truncateStoredText(input.userAgent, 512),
		ipHash: input.ipHash ?? null,
		utmSource: truncateStoredText(input.utmSource, 256),
		utmMedium: truncateStoredText(input.utmMedium, 256),
		utmCampaign: truncateStoredText(input.utmCampaign, 256),
		utmTerm: truncateStoredText(input.utmTerm, 256),
		utmContent: truncateStoredText(input.utmContent, 256),
		createdAt: timestamp,
	});

	await db
		.update(shortLinks)
		.set({
			hitCount: sql`${shortLinks.hitCount} + 1`,
			lastClickAt: timestamp,
			updatedAt: timestamp,
		})
		.where(eq(shortLinks.id, input.linkId));
}
