-- Hosted MCP OAuth tables, per-user MCP access, and admin server setting.

ALTER TABLE `user` ADD COLUMN `mcp_access_enabled` integer DEFAULT true NOT NULL;

CREATE TABLE `app_setting` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL
);

INSERT INTO `app_setting` (`key`, `value`, `updated_at`)
VALUES ('mcp.enabled', 'false', unixepoch());

CREATE TABLE `oauthApplication` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `icon` text,
  `metadata` text,
  `clientId` text NOT NULL,
  `clientSecret` text,
  `redirectUrls` text NOT NULL,
  `type` text NOT NULL,
  `disabled` integer DEFAULT false NOT NULL,
  `userId` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `oauthApplication_clientId_unique` ON `oauthApplication` (`clientId`);
CREATE INDEX `oauth_application_user_id_idx` ON `oauthApplication` (`userId`);

CREATE TABLE `oauthAccessToken` (
  `id` text PRIMARY KEY NOT NULL,
  `accessToken` text NOT NULL,
  `refreshToken` text NOT NULL,
  `accessTokenExpiresAt` integer NOT NULL,
  `refreshTokenExpiresAt` integer NOT NULL,
  `clientId` text NOT NULL,
  `userId` text,
  `scopes` text NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `oauthAccessToken_accessToken_unique` ON `oauthAccessToken` (`accessToken`);
CREATE UNIQUE INDEX `oauthAccessToken_refreshToken_unique` ON `oauthAccessToken` (`refreshToken`);
CREATE INDEX `oauth_access_token_client_id_idx` ON `oauthAccessToken` (`clientId`);
CREATE INDEX `oauth_access_token_user_id_idx` ON `oauthAccessToken` (`userId`);

CREATE TABLE `oauthConsent` (
  `id` text PRIMARY KEY NOT NULL,
  `clientId` text NOT NULL,
  `userId` text NOT NULL,
  `scopes` text NOT NULL,
  `consentGiven` integer NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `oauth_consent_client_id_idx` ON `oauthConsent` (`clientId`);
CREATE INDEX `oauth_consent_user_id_idx` ON `oauthConsent` (`userId`);

UPDATE role
SET permissions = REPLACE(permissions, '"]', '","mcp.manage"]')
WHERE is_system = 1
  AND permissions NOT LIKE '%"mcp.manage"%';
