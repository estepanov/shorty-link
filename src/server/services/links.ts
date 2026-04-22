import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";

import type { AppDb } from "../db/client";
import {
  DEFAULT_HOSTNAME,
  adminInvites,
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

export function isAdminRole(role: string | null | undefined) {
  return (role ?? "")
    .split(",")
    .map((value) => value.trim())
    .includes("admin");
}

export function normalizeHostname(value?: string | null) {
  if (!value || !value.trim()) {
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
      .where(and(eq(shortLinks.hostname, hostname), eq(shortLinks.slug, candidate)))
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
    db.select().from(managedDomains).orderBy(managedDomains.hostname),
    db.select().from(shortLinks).orderBy(desc(shortLinks.updatedAt)),
    db
      .select()
      .from(adminInvites)
      .where(and(isNull(adminInvites.acceptedAt), gt(adminInvites.expiresAt, now())))
      .orderBy(desc(adminInvites.createdAt)),
    db.select().from(redirectEvents).orderBy(desc(redirectEvents.createdAt)).limit(100),
    Promise.all([
      db.select({ total: count() }).from(shortLinks),
      db.select({ total: count() }).from(redirectEvents),
      db.select({ total: count() }).from(managedDomains),
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
    },
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

  if (!existing.length) {
    return;
  }

  const [{ totalLinks }] = await db
    .select({ totalLinks: count() })
    .from(shortLinks)
    .where(eq(shortLinks.hostname, existing[0]!.hostname));

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
  const statusCode = input.statusCode === 301 ? 301 : 302;

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
    country: input.country ?? null,
    city: input.city ?? null,
    colo: input.colo ?? null,
    referer: input.referer ?? null,
    userAgent: input.userAgent ?? null,
    ipHash: input.ipHash ?? null,
    createdAt: timestamp,
  });

  await db
    .update(shortLinks)
    .set({
      hitCount: sql`${shortLinks.hitCount} + 1`,
      updatedAt: timestamp,
    })
    .where(eq(shortLinks.id, input.linkId));
}
