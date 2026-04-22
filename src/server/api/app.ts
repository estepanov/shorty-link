import { serverTiming } from "@elysiajs/server-timing";
import { env, waitUntil } from "cloudflare:workers";
import { and, eq, ne } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";

import { createTranslator, normalizeLocale } from "@/lib/i18n";

import { createBootstrapContext, createInviteContext } from "../auth/onboarding";
import { requireAdmin } from "../auth/session";
import { createDb } from "../db/client";
import { user } from "../db/schema";
import {
  buildAnalyticsTarget,
  buildInviteUrl,
  buildRedirectTarget,
  createInvite,
  deleteDomain,
  deleteLink,
  extractUtmParams,
  getDomainById,
  getBootstrapState,
  getDashboardData,
  getInviteByToken,
  getLinkById,
  getLinkStats,
  listDomains,
  listShortLinks,
  recordRedirectEvent,
  resolveRedirect,
  saveDomain,
  saveLink,
  suggestSlugFromUrl,
} from "../services/links";

type AiBinding = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

const runtimeEnv = env as typeof env & {
  AI?: AiBinding;
  BETTER_AUTH_SECRET?: string;
};

const linkBody = t.Object({
  hostname: t.Optional(t.String()),
  slug: t.Optional(t.String()),
  targetUrl: t.String({ minLength: 1 }),
  title: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  statusCode: t.Optional(t.Number()),
  preserveQueryParams: t.Optional(t.Boolean()),
  isActive: t.Optional(t.Boolean()),
});

const domainBody = t.Object({
  hostname: t.String({ minLength: 1 }),
  label: t.Optional(t.String()),
  isPrimary: t.Optional(t.Boolean()),
  isActive: t.Optional(t.Boolean()),
});

function getClientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

async function hashIp(value: string | null) {
  if (!value) {
    return null;
  }

  const material = `${runtimeEnv.BETTER_AUTH_SECRET ?? "shorty-link"}:${value}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function localeFromRequest(request: Request) {
  return normalizeLocale(
    request.headers.get("cookie")?.match(/shorty_locale=([^;]+)/)?.[1] ??
      request.headers.get("accept-language"),
  );
}

async function jsonError(error: unknown, request: Request) {
  const tMessage = createTranslator(localeFromRequest(request));

  if (error instanceof Response) {
    return Response.json(
      {
        code: "AUTH_ERROR",
        message: tMessage(await error.text()),
      },
      { status: error.status },
    );
  }

  const key = error instanceof Error ? error.message : "errors.unknown";
  return Response.json(
    {
      code: key,
      message: tMessage(key),
    },
    { status: 400 },
  );
}

async function requireAdminOrError(request: Request) {
  try {
    return await requireAdmin(request);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    throw new Response("errors.unauthorized", { status: 401 });
  }
}

async function suggestSlugWithAi(targetUrl: string) {
  const fallback = suggestSlugFromUrl(targetUrl);

  if (!runtimeEnv.AI) {
    return fallback;
  }

  const response = await runtimeEnv.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [
      {
        role: "system",
        content:
          "Return exactly one lowercase URL slug using only letters, numbers, hyphens, and underscores. Do not include commentary.",
      },
      {
        role: "user",
        content: `Suggest a concise memorable slug for ${targetUrl}`,
      },
    ],
    max_tokens: 24,
  });

  const raw =
    typeof response === "string"
      ? response
      : typeof response === "object" &&
          response !== null &&
          "response" in response &&
          typeof response.response === "string"
        ? response.response
        : fallback;

  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

export const app = new Elysia({
  aot: false,
  adapter: CloudflareAdapter,
  normalize: "typebox",
})
  .derive(({ request }) => ({
    db: createDb(),
    locale: localeFromRequest(request),
  }))
  .use(
    serverTiming({
      enabled: true,
      allow: ({ request }) => new URL(request.url).pathname.startsWith("/api/admin"),
      trace: {
        request: true,
        beforeHandle: true,
        handle: true,
        afterHandle: true,
        total: true,
      },
    }),
  )
  .onError(({ error, request }) => jsonError(error, request))
  .get("/api/health", () => ({
    ok: true,
    service: "shorty-link",
  }))
  .group("/api/admin", (admin) =>
    admin
      .get("/bootstrap", ({ db }) => getBootstrapState(db))
      .post(
        "/onboarding/bootstrap",
        async ({ body, db }) => ({
          context: await createBootstrapContext(db, body),
        }),
        {
          body: t.Object({
            email: t.String({ format: "email" }),
            locale: t.Optional(t.String()),
            name: t.String({ minLength: 2 }),
          }),
        },
      )
      .get(
        "/invites/:token",
        async ({ db, params }) => {
          const invite = await getInviteByToken(db, params.token);
          if (!invite) {
            throw new Error("errors.inviteMissing");
          }

          return {
            email: invite.email,
            expiresAt: invite.expiresAt,
            token: invite.token,
          };
        },
        {
          params: t.Object({
            token: t.String({ minLength: 16 }),
          }),
        },
      )
      .post(
        "/onboarding/invite",
        async ({ body, db }) => ({
          context: await createInviteContext(db, body),
        }),
        {
          body: t.Object({
            locale: t.Optional(t.String()),
            name: t.String({ minLength: 2 }),
            token: t.String({ minLength: 16 }),
          }),
        },
      )
      .get("/dashboard", async ({ db, request }) => {
        const session = await requireAdminOrError(request);
        const dashboard = await getDashboardData(db);
        const origin = new URL(request.url).origin;

        return {
          ...dashboard,
          invites: dashboard.invites.map((invite) => ({
            ...invite,
            inviteUrl: buildInviteUrl(origin, invite.token),
          })),
          session,
        };
      })
      .patch(
        "/profile",
        async ({ body, db, request }) => {
          const session = await requireAdminOrError(request);
          const email = body.email.trim().toLowerCase();
          const existing = await db
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.email, email), ne(user.id, session.user.id)))
            .limit(1);

          if (existing[0]) {
            throw new Error("errors.profileEmailTaken");
          }

          await db
            .update(user)
            .set({
              email,
              locale: normalizeLocale(body.locale),
              name: body.name.trim(),
              updatedAt: new Date(),
            })
            .where(eq(user.id, session.user.id));

          return { ok: true };
        },
        {
          body: t.Object({
            email: t.String({ format: "email" }),
            locale: t.Optional(t.String()),
            name: t.String({ minLength: 2 }),
          }),
        },
      )
      .get(
        "/links",
        async ({ db, query, request }) => {
          await requireAdminOrError(request);
          return listShortLinks(db, {
            active: query.active,
            hostname: query.hostname,
            page: query.page,
            pageSize: query.pageSize,
            search: query.search,
            statusCode:
              query.statusCode === 301 || query.statusCode === 302
                ? query.statusCode
                : "all",
          });
        },
        {
          query: t.Object({
            active: t.Optional(
              t.Union([t.Literal("active"), t.Literal("inactive"), t.Literal("all")]),
            ),
            hostname: t.Optional(t.String()),
            page: t.Optional(t.Number({ minimum: 1 })),
            pageSize: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
            search: t.Optional(t.String()),
            statusCode: t.Optional(t.Union([t.Literal(301), t.Literal(302)])),
          }),
        },
      )
      .post(
        "/links",
        async ({ body, db, request }) => {
          const session = await requireAdminOrError(request);
          return {
            id: await saveLink(db, {
              ...body,
              createdBy: session.user.id,
            }),
          };
        },
        { body: linkBody },
      )
      .get(
        "/links/:id",
        async ({ db, params, request }) => {
          await requireAdminOrError(request);
          const link = await getLinkById(db, params.id);
          if (!link) {
            throw new Error("errors.linkMissing");
          }

          return link;
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
        },
      )
      .get(
        "/links/:id/stats",
        async ({ db, params, query, request }) => {
          await requireAdminOrError(request);
          const link = await getLinkById(db, params.id);
          if (!link) {
            throw new Error("errors.linkMissing");
          }

          const stats = await getLinkStats(db, params.id, {
            days: query.days,
          });

          return { link, stats };
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
          query: t.Object({
            days: t.Optional(t.Number({ minimum: 1, maximum: 180 })),
          }),
        },
      )
      .patch(
        "/links/:id",
        async ({ body, db, params, request }) => {
          const session = await requireAdminOrError(request);
          return {
            id: await saveLink(db, {
              ...body,
              id: params.id,
              createdBy: session.user.id,
            }),
          };
        },
        {
          body: linkBody,
          params: t.Object({ id: t.String({ minLength: 1 }) }),
        },
      )
      .delete(
        "/links/:id",
        async ({ db, params, request }) => {
          await requireAdminOrError(request);
          await deleteLink(db, params.id);
          return { ok: true };
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
        },
      )
      .get("/domains", async ({ db, request }) => {
        await requireAdminOrError(request);
        return listDomains(db);
      })
      .post(
        "/domains",
        async ({ body, db, request }) => {
          const session = await requireAdminOrError(request);
          return {
            id: await saveDomain(db, {
              ...body,
              createdBy: session.user.id,
            }),
          };
        },
        { body: domainBody },
      )
      .get(
        "/domains/:id",
        async ({ db, params, request }) => {
          await requireAdminOrError(request);
          const domain = await getDomainById(db, params.id);
          if (!domain) {
            throw new Error("errors.domainMissing");
          }

          return domain;
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
        },
      )
      .patch(
        "/domains/:id",
        async ({ body, db, params, request }) => {
          const session = await requireAdminOrError(request);
          return {
            id: await saveDomain(db, {
              ...body,
              id: params.id,
              createdBy: session.user.id,
            }),
          };
        },
        {
          body: domainBody,
          params: t.Object({ id: t.String({ minLength: 1 }) }),
        },
      )
      .delete(
        "/domains/:id",
        async ({ db, params, request }) => {
          await requireAdminOrError(request);
          await deleteDomain(db, params.id);
          return { ok: true };
        },
        {
          params: t.Object({ id: t.String({ minLength: 1 }) }),
        },
      )
      .post(
        "/invites",
        async ({ body, db, request }) => {
          const session = await requireAdminOrError(request);
          const invite = await createInvite(db, {
            email: body.email,
            expiresInDays: body.expiresInDays,
            invitedBy: session.user.id,
            role: "admin",
          });

          return {
            ...invite,
            inviteUrl: buildInviteUrl(new URL(request.url).origin, invite.token),
          };
        },
        {
          body: t.Object({
            email: t.String({ format: "email" }),
            expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
          }),
        },
      )
      .get(
        "/suggest-slug",
        async ({ query, request }) => {
          await requireAdminOrError(request);
          return { slug: await suggestSlugWithAi(query.targetUrl) };
        },
        {
          query: t.Object({
            targetUrl: t.String({ minLength: 1 }),
          }),
        },
      ),
  )
  .get("/*", async ({ db, request }) => {
    const url = new URL(request.url);
    const tMessage = createTranslator(localeFromRequest(request));
    const slug = url.pathname.replace(/^\/+/, "");

    if (!slug) {
      return new Response(tMessage("redirect.online"), { status: 200 });
    }

    const link = await resolveRedirect(db, {
      hostname: url.hostname.toLowerCase(),
      slug,
    });

    if (!link) {
      return new Response(tMessage("redirect.notFound"), { status: 404 });
    }

    const redirectTarget = buildRedirectTarget(
      link.targetUrl,
      request.url,
      link.preserveQueryParams,
    );
    const analyticsTarget = buildAnalyticsTarget(
      link.targetUrl,
      request.url,
      link.preserveQueryParams,
    );
    const cf = request.cf;

    const utm = extractUtmParams(request.url);

    waitUntil(
      (async () => {
        await recordRedirectEvent(db, {
          linkId: link.id,
          hostname: link.hostname,
          slug: link.slug,
          targetUrl: analyticsTarget,
          statusCode: link.statusCode,
          city: typeof cf?.city === "string" ? cf.city : null,
          colo: typeof cf?.colo === "string" ? cf.colo : null,
          country: typeof cf?.country === "string" ? cf.country : null,
          ipHash: await hashIp(getClientIp(request)),
          referer: request.headers.get("referer"),
          userAgent: request.headers.get("user-agent"),
          ...utm,
        });
      })(),
    );

    return Response.redirect(redirectTarget, link.statusCode as 301 | 302);
  });

export type App = typeof app;
