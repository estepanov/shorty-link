import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const DEFAULT_HOSTNAME = "__default__";

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.notNull()
		.default(true),
	image: text("image"),
	role: text("role").notNull().default("admin"),
	locale: text("locale").notNull().default("en"),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp",
		}),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }),
	updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const passkey = sqliteTable(
	"passkey",
	{
		id: text("id").primaryKey(),
		name: text("name"),
		publicKey: text("public_key").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		credentialID: text("credential_id").notNull(),
		counter: integer("counter").notNull(),
		deviceType: text("device_type").notNull(),
		backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
		transports: text("transports"),
		createdAt: integer("created_at", { mode: "timestamp" }),
		aaguid: text("aaguid"),
	},
	(table) => [
		uniqueIndex("passkey_credential_id_idx").on(table.credentialID),
		index("passkey_user_id_idx").on(table.userId),
	],
);

export const apiKey = sqliteTable(
	"apikey",
	{
		id: text("id").primaryKey(),
		configId: text("config_id").notNull().default("default"),
		name: text("name"),
		start: text("start"),
		prefix: text("prefix"),
		key: text("key").notNull(),
		referenceId: text("reference_id").notNull(),
		refillInterval: integer("refill_interval"),
		refillAmount: integer("refill_amount"),
		lastRefillAt: integer("last_refill_at", { mode: "timestamp" }),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" })
			.notNull()
			.default(true),
		rateLimitTimeWindow: integer("rate_limit_time_window"),
		rateLimitMax: integer("rate_limit_max"),
		requestCount: integer("request_count").notNull().default(0),
		remaining: integer("remaining"),
		lastRequest: integer("last_request", { mode: "timestamp" }),
		expiresAt: integer("expires_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
		permissions: text("permissions"),
		metadata: text("metadata", { mode: "json" }).$type<Record<
			string,
			unknown
		> | null>(),
	},
	(table) => [
		index("apikey_reference_id_idx").on(table.referenceId),
		index("apikey_key_idx").on(table.key),
	],
);

export const managedDomains = sqliteTable("managed_domain", {
	id: text("id").primaryKey(),
	hostname: text("hostname").notNull().unique(),
	label: text("label"),
	isPrimary: integer("is_primary", { mode: "boolean" })
		.notNull()
		.default(false),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdBy: text("created_by"),
	createdAt: integer("created_at").notNull(),
});

export const shortLinks = sqliteTable(
	"short_link",
	{
		id: text("id").primaryKey(),
		hostname: text("hostname").notNull().default(DEFAULT_HOSTNAME),
		slug: text("slug").notNull(),
		targetUrl: text("target_url").notNull(),
		title: text("title"),
		notes: text("notes"),
		statusCode: integer("status_code").notNull().default(302),
		preserveQueryParams: integer("preserve_query_params", { mode: "boolean" })
			.notNull()
			.default(false),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		hitCount: integer("hit_count").notNull().default(0),
		lastClickAt: integer("last_click_at"),
		createdBy: text("created_by"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("short_link_hostname_slug_idx").on(table.hostname, table.slug),
		index("short_link_slug_idx").on(table.slug),
	],
);

export const adminInvites = sqliteTable(
	"admin_invite",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		token: text("token").notNull().unique(),
		role: text("role").notNull().default("admin"),
		invitedBy: text("invited_by"),
		expiresAt: integer("expires_at").notNull(),
		acceptedAt: integer("accepted_at"),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("admin_invite_email_idx").on(table.email)],
);

export const redirectEvents = sqliteTable(
	"redirect_event",
	{
		id: text("id").primaryKey(),
		linkId: text("link_id")
			.notNull()
			.references(() => shortLinks.id, { onDelete: "cascade" }),
		hostname: text("hostname").notNull(),
		slug: text("slug").notNull(),
		targetUrl: text("target_url").notNull(),
		statusCode: integer("status_code").notNull(),
		country: text("country"),
		city: text("city"),
		colo: text("colo"),
		referer: text("referer"),
		userAgent: text("user_agent"),
		ipHash: text("ip_hash"),
		utmSource: text("utm_source"),
		utmMedium: text("utm_medium"),
		utmCampaign: text("utm_campaign"),
		utmTerm: text("utm_term"),
		utmContent: text("utm_content"),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		index("redirect_event_link_id_idx").on(table.linkId),
		index("redirect_event_created_at_idx").on(table.createdAt),
		index("redirect_event_utm_source_idx").on(table.linkId, table.utmSource),
		index("redirect_event_utm_medium_idx").on(table.linkId, table.utmMedium),
		index("redirect_event_utm_campaign_idx").on(
			table.linkId,
			table.utmCampaign,
		),
		index("redirect_event_utm_term_idx").on(table.linkId, table.utmTerm),
		index("redirect_event_utm_content_idx").on(table.linkId, table.utmContent),
	],
);

export const schema = {
	account,
	adminInvites,
	apiKey,
	apikey: apiKey,
	managedDomains,
	passkey,
	redirectEvents,
	session,
	shortLinks,
	user,
	verification,
};

export type Schema = typeof schema;
