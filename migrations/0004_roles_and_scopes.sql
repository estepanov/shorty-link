-- Roles, scopes, and per-user role assignments.

CREATE TABLE `role` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `permissions` text DEFAULT '[]' NOT NULL,
  `is_system` integer DEFAULT false NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `role_name_unique` ON `role` (`name`);

INSERT INTO `role` (`id`, `name`, `description`, `permissions`, `is_system`, `created_at`, `updated_at`)
VALUES
  ('system_owner', 'Owner', 'Full access. The owner role cannot be deleted or stripped of permissions.', '["links.read","links.write","links.delete","domains.read","domains.write","domains.delete","users.read","users.write","users.delete","invites.manage","sessions.manage","apikeys.manage","roles.manage","analytics.read"]', 1, unixepoch(), unixepoch()),
  ('system_admin', 'Admin', 'Full administrative access. Default role for new invites.', '["links.read","links.write","links.delete","domains.read","domains.write","domains.delete","users.read","users.write","users.delete","invites.manage","sessions.manage","apikeys.manage","roles.manage","analytics.read"]', 1, unixepoch(), unixepoch());

-- Rebuild user table: drop role text column, add role_id FK.
CREATE TABLE `__new_user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `email_verified` integer DEFAULT true NOT NULL,
  `image` text,
  `role_id` text NOT NULL,
  `locale` text DEFAULT 'en' NOT NULL,
  `is_active` integer DEFAULT true NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE restrict
);

INSERT INTO `__new_user` (
  `id`, `name`, `email`, `email_verified`, `image`,
  `role_id`, `locale`, `is_active`, `created_at`, `updated_at`
)
SELECT
  u.`id`, u.`name`, u.`email`, u.`email_verified`, u.`image`,
  CASE
    WHEN u.`id` = (
      SELECT `id` FROM `user`
      ORDER BY `created_at` ASC, `id` ASC
      LIMIT 1
    ) THEN 'system_owner'
    ELSE 'system_admin'
  END,
  u.`locale`, u.`is_active`, u.`created_at`, u.`updated_at`
FROM `user` u;

DROP TABLE `user`;
ALTER TABLE `__new_user` RENAME TO `user`;
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);

-- Rebuild admin_invite table: drop role text column, add role_id FK defaulting to admin role.
CREATE TABLE `__new_admin_invite` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `token` text NOT NULL,
  `role_id` text NOT NULL,
  `invited_by` text,
  `expires_at` integer NOT NULL,
  `accepted_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE restrict
);

INSERT INTO `__new_admin_invite` (
  `id`, `email`, `token`, `role_id`, `invited_by`, `expires_at`, `accepted_at`, `created_at`
)
SELECT `id`, `email`, `token`, 'system_admin', `invited_by`, `expires_at`, `accepted_at`, `created_at`
FROM `admin_invite`;

DROP TABLE `admin_invite`;
ALTER TABLE `__new_admin_invite` RENAME TO `admin_invite`;
CREATE UNIQUE INDEX `admin_invite_token_unique` ON `admin_invite` (`token`);
CREATE INDEX `admin_invite_email_idx` ON `admin_invite` (`email`);

-- Per-role scope tables.
CREATE TABLE `role_domain_scope` (
  `id` text PRIMARY KEY NOT NULL,
  `role_id` text NOT NULL,
  `domain_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`domain_id`) REFERENCES `managed_domain`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `role_domain_scope_unique` ON `role_domain_scope` (`role_id`, `domain_id`);
CREATE INDEX `role_domain_scope_role_idx` ON `role_domain_scope` (`role_id`);

CREATE TABLE `role_link_scope` (
  `id` text PRIMARY KEY NOT NULL,
  `role_id` text NOT NULL,
  `link_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`link_id`) REFERENCES `short_link`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `role_link_scope_unique` ON `role_link_scope` (`role_id`, `link_id`);
CREATE INDEX `role_link_scope_role_idx` ON `role_link_scope` (`role_id`);
