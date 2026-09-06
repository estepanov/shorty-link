-- Better Auth 1.7 account identity (provider-id strategy) plus SSO tables.

CREATE TABLE `__new_account` (
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
	`issuer` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

INSERT INTO `__new_account` (
	`id`,
	`account_id`,
	`provider_id`,
	`user_id`,
	`access_token`,
	`refresh_token`,
	`id_token`,
	`access_token_expires_at`,
	`refresh_token_expires_at`,
	`scope`,
	`password`,
	`issuer`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`account_id`,
	`provider_id`,
	`user_id`,
	`access_token`,
	`refresh_token`,
	`id_token`,
	`access_token_expires_at`,
	`refresh_token_expires_at`,
	`scope`,
	`password`,
	'local:' || `provider_id`,
	`created_at`,
	`updated_at`
FROM `account`;

DROP TABLE `account`;
ALTER TABLE `__new_account` RENAME TO `account`;
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);
CREATE UNIQUE INDEX `account_issuer_account_id_idx` ON `account` (`issuer`, `account_id`);

CREATE TABLE `ssoProvider` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`oidcConfig` text,
	`samlConfig` text,
	`userId` text NOT NULL,
	`providerId` text NOT NULL,
	`organizationId` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `ssoProvider_providerId_unique` ON `ssoProvider` (`providerId`);
CREATE INDEX `ssoProvider_userId_idx` ON `ssoProvider` (`userId`);
CREATE INDEX `ssoProvider_domain_idx` ON `ssoProvider` (`domain`);

CREATE TABLE `sso_provider_settings` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`protocol` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`jit_enabled` integer DEFAULT false NOT NULL,
	`default_role_id` text,
	`enforce_sso` integer DEFAULT false NOT NULL,
	`allow_idp_initiated` integer DEFAULT false NOT NULL,
	`group_claim` text DEFAULT 'groups' NOT NULL,
	`group_role_mappings` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `ssoProvider`(`providerId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE restrict
);

UPDATE role
SET permissions = REPLACE(permissions, ']', ',"sso.read","sso.write","sso.delete"]')
WHERE id IN ('system_owner', 'system_admin')
	AND permissions NOT LIKE '%"sso.read"%';
