import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { REDIRECT_EVENT_SCHEMA_VERSION } from "./redirect-event-schema-version";

export const DEFAULT_HOSTNAME = "__default__";

export const SYSTEM_ROLE_OWNER = "system_owner";
export const SYSTEM_ROLE_ADMIN = "system_admin";

export const roles = sqliteTable("role", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	description: text("description"),
	permissions: text("permissions").notNull().default("[]"),
	isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const user = sqliteTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: integer("email_verified", { mode: "boolean" })
			.notNull()
			.default(true),
		image: text("image"),
		roleId: text("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "restrict" }),
		locale: text("locale").notNull().default("en"),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		invitedBy: text("invited_by"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [index("user_invited_by_idx").on(table.invitedBy)],
);

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
		issuer: text("issuer").notNull().default("local:unknown"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		index("account_user_id_idx").on(table.userId),
		uniqueIndex("account_issuer_account_id_idx").on(
			table.issuer,
			table.accountId,
		),
	],
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
	rootBehavior: text("root_behavior").notNull().default("landing"),
	rootRedirectStatusCode: integer("root_redirect_status_code"),
	rootRedirectTargetUrl: text("root_redirect_target_url"),
	unknownSlugBehavior: text("unknown_slug_behavior")
		.notNull()
		.default("not_found"),
	unknownSlugRedirectStatusCode: integer("unknown_slug_redirect_status_code"),
	unknownSlugRedirectTargetUrl: text("unknown_slug_redirect_target_url"),
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
		roleId: text("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "restrict" }),
		invitedBy: text("invited_by"),
		expiresAt: integer("expires_at").notNull(),
		acceptedAt: integer("accepted_at"),
		ssoClaimId: text("sso_claim_id"),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("admin_invite_email_idx").on(table.email)],
);

export const roleDomainScopes = sqliteTable(
	"role_domain_scope",
	{
		id: text("id").primaryKey(),
		roleId: text("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
		domainId: text("domain_id")
			.notNull()
			.references(() => managedDomains.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("role_domain_scope_unique").on(table.roleId, table.domainId),
		index("role_domain_scope_role_idx").on(table.roleId),
	],
);

export const roleLinkScopes = sqliteTable(
	"role_link_scope",
	{
		id: text("id").primaryKey(),
		roleId: text("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
		linkId: text("link_id")
			.notNull()
			.references(() => shortLinks.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("role_link_scope_unique").on(table.roleId, table.linkId),
		index("role_link_scope_role_idx").on(table.roleId),
	],
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
		userAgentBrowser: text("user_agent_browser"),
		userAgentOs: text("user_agent_os"),
		userAgentDeviceType: text("user_agent_device_type"),
		userAgentIsBot: integer("user_agent_is_bot", { mode: "boolean" }),
		ipHash: text("ip_hash"),
		utmSource: text("utm_source"),
		utmMedium: text("utm_medium"),
		utmCampaign: text("utm_campaign"),
		utmTerm: text("utm_term"),
		utmContent: text("utm_content"),
		eventSchemaVersion: integer("event_schema_version")
			.notNull()
			.default(REDIRECT_EVENT_SCHEMA_VERSION),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		index("redirect_event_link_id_idx").on(table.linkId),
		index("redirect_event_created_at_idx").on(table.createdAt),
		index("redirect_event_user_agent_browser_idx").on(
			table.linkId,
			table.userAgentBrowser,
		),
		index("redirect_event_user_agent_os_idx").on(
			table.linkId,
			table.userAgentOs,
		),
		index("redirect_event_user_agent_device_type_idx").on(
			table.linkId,
			table.userAgentDeviceType,
		),
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

export const ssoProvider = sqliteTable(
	"ssoProvider",
	{
		id: text("id").primaryKey(),
		issuer: text("issuer").notNull(),
		domain: text("domain").notNull(),
		oidcConfig: text("oidcConfig"),
		samlConfig: text("samlConfig"),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		providerId: text("providerId").notNull().unique(),
		organizationId: text("organizationId"),
	},
	(table) => [
		index("ssoProvider_userId_idx").on(table.userId),
		index("ssoProvider_domain_idx").on(table.domain),
	],
);

export const ssoProviderSettings = sqliteTable("sso_provider_settings", {
	providerId: text("provider_id")
		.primaryKey()
		.references(() => ssoProvider.providerId, { onDelete: "cascade" }),
	protocol: text("protocol").notNull(),
	displayName: text("display_name").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	jitEnabled: integer("jit_enabled", { mode: "boolean" })
		.notNull()
		.default(false),
	defaultRoleId: text("default_role_id").references(() => roles.id, {
		onDelete: "restrict",
	}),
	enforceSso: integer("enforce_sso", { mode: "boolean" })
		.notNull()
		.default(false),
	allowIdpInitiated: integer("allow_idp_initiated", { mode: "boolean" })
		.notNull()
		.default(false),
	groupClaim: text("group_claim").notNull().default("groups"),
	groupRoleMappings: text("group_role_mappings").notNull().default("[]"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const schema = {
	account,
	adminInvites,
	apiKey,
	apikey: apiKey,
	managedDomains,
	passkey,
	redirectEvents,
	roleDomainScopes,
	roleLinkScopes,
	roles,
	session,
	shortLinks,
	ssoProvider,
	ssoProviderSettings,
	user,
	verification,
};

export type Schema = typeof schema;
