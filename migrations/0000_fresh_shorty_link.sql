CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `email_verified` integer DEFAULT true NOT NULL,
  `image` text,
  `role` text DEFAULT 'admin' NOT NULL,
  `locale` text DEFAULT 'en' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);

CREATE TABLE `session` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `token` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `ip_address` text,
  `user_agent` text,
  `user_id` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);

CREATE TABLE `account` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `user_id` text NOT NULL,
  `access_token` text,
  `refresh_token` text,
  `id_token` text,
  `access_token_expires_at` integer,
  `refresh_token_expires_at` integer,
  `scope` text,
  `password` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);

CREATE TABLE `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer,
  `updated_at` integer
);

CREATE TABLE `passkey` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text,
  `public_key` text NOT NULL,
  `user_id` text NOT NULL,
  `credential_id` text NOT NULL,
  `counter` integer NOT NULL,
  `device_type` text NOT NULL,
  `backed_up` integer NOT NULL,
  `transports` text,
  `created_at` integer,
  `aaguid` text,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `passkey_credential_id_idx` ON `passkey` (`credential_id`);
CREATE INDEX `passkey_user_id_idx` ON `passkey` (`user_id`);

CREATE TABLE `apikey` (
  `id` text PRIMARY KEY NOT NULL,
  `config_id` text DEFAULT 'default' NOT NULL,
  `name` text,
  `start` text,
  `prefix` text,
  `key` text NOT NULL,
  `reference_id` text NOT NULL,
  `refill_interval` integer,
  `refill_amount` integer,
  `last_refill_at` integer,
  `enabled` integer DEFAULT true NOT NULL,
  `rate_limit_enabled` integer DEFAULT true NOT NULL,
  `rate_limit_time_window` integer,
  `rate_limit_max` integer,
  `request_count` integer DEFAULT 0 NOT NULL,
  `remaining` integer,
  `last_request` integer,
  `expires_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `permissions` text,
  `metadata` text
);
CREATE INDEX `apikey_reference_id_idx` ON `apikey` (`reference_id`);
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);

CREATE TABLE `managed_domain` (
  `id` text PRIMARY KEY NOT NULL,
  `hostname` text NOT NULL,
  `label` text,
  `is_primary` integer DEFAULT false NOT NULL,
  `is_active` integer DEFAULT true NOT NULL,
  `created_by` text,
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `managed_domain_hostname_unique` ON `managed_domain` (`hostname`);

CREATE TABLE `short_link` (
  `id` text PRIMARY KEY NOT NULL,
  `hostname` text DEFAULT '__default__' NOT NULL,
  `slug` text NOT NULL,
  `target_url` text NOT NULL,
  `title` text,
  `notes` text,
  `status_code` integer DEFAULT 302 NOT NULL,
  `preserve_query_params` integer DEFAULT false NOT NULL,
  `is_active` integer DEFAULT true NOT NULL,
  `hit_count` integer DEFAULT 0 NOT NULL,
  `created_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `short_link_hostname_slug_idx` ON `short_link` (`hostname`, `slug`);
CREATE INDEX `short_link_slug_idx` ON `short_link` (`slug`);

CREATE TABLE `admin_invite` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `token` text NOT NULL,
  `role` text DEFAULT 'admin' NOT NULL,
  `invited_by` text,
  `expires_at` integer NOT NULL,
  `accepted_at` integer,
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `admin_invite_token_unique` ON `admin_invite` (`token`);
CREATE INDEX `admin_invite_email_idx` ON `admin_invite` (`email`);

CREATE TABLE `redirect_event` (
  `id` text PRIMARY KEY NOT NULL,
  `link_id` text NOT NULL,
  `hostname` text NOT NULL,
  `slug` text NOT NULL,
  `target_url` text NOT NULL,
  `status_code` integer NOT NULL,
  `country` text,
  `city` text,
  `colo` text,
  `referer` text,
  `user_agent` text,
  `ip_hash` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`link_id`) REFERENCES `short_link`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `redirect_event_link_id_idx` ON `redirect_event` (`link_id`);
CREATE INDEX `redirect_event_created_at_idx` ON `redirect_event` (`created_at`);
