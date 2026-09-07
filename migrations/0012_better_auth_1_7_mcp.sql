-- Port the hosted MCP OAuth provider from Better Auth 1.6 to 1.7.
-- Registered clients are retained. Existing grants and tokens used the removed
-- 1.6 format and endpoints, so they are intentionally revoked.

ALTER TABLE `oauthApplication` RENAME TO `oauthApplication_legacy`;
DROP TABLE `oauthAccessToken`;
DROP TABLE `oauthConsent`;

CREATE TABLE `oauthClient` (
  `id` text PRIMARY KEY NOT NULL,
  `clientId` text NOT NULL,
  `clientSecret` text,
  `clientDiscoveryId` text,
  `disabled` integer DEFAULT false NOT NULL,
  `skipConsent` integer,
  `enableEndSession` integer,
  `subjectType` text,
  `scopes` text,
  `clientCredentialsScopes` text DEFAULT '[]' NOT NULL,
  `userId` text,
  `createdAt` integer,
  `updatedAt` integer,
  `name` text,
  `uri` text,
  `icon` text,
  `contacts` text,
  `tos` text,
  `policy` text,
  `softwareId` text,
  `softwareVersion` text,
  `softwareStatement` text,
  `redirectUris` text NOT NULL,
  `postLogoutRedirectUris` text,
  `backchannelLogoutUri` text,
  `backchannelLogoutSessionRequired` integer,
  `tokenEndpointAuthMethod` text,
  `applicationType` text,
  `jwks` text,
  `jwksUri` text,
  `grantTypes` text,
  `responseTypes` text,
  `requirePKCE` integer,
  `dpopBoundAccessTokens` integer DEFAULT false NOT NULL,
  `referenceId` text,
  `metadata` text,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `oauthClient_clientId_unique` ON `oauthClient` (`clientId`);
CREATE INDEX `oauth_client_user_id_idx` ON `oauthClient` (`userId`);

INSERT INTO `oauthClient` (
  `id`,
  `clientId`,
  `clientSecret`,
  `disabled`,
  `clientCredentialsScopes`,
  `userId`,
  `createdAt`,
  `updatedAt`,
  `name`,
  `icon`,
  `redirectUris`,
  `tokenEndpointAuthMethod`,
  `applicationType`,
  `dpopBoundAccessTokens`,
  `metadata`
)
SELECT
  `id`,
  `clientId`,
  `clientSecret`,
  `disabled`,
  '[]',
  `userId`,
  `createdAt`,
  `updatedAt`,
  `name`,
  `icon`,
  json_array(`redirectUrls`),
  CASE
    WHEN `clientSecret` IS NULL OR `clientSecret` = '' THEN 'none'
    ELSE 'client_secret_basic'
  END,
  CASE
    WHEN `type` IN ('web', 'native') THEN `type`
    ELSE 'web'
  END,
  false,
  CASE WHEN json_valid(`metadata`) THEN `metadata` ELSE NULL END
FROM `oauthApplication_legacy`;

DROP TABLE `oauthApplication_legacy`;

CREATE TABLE `oauthResource` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `name` text NOT NULL,
  `accessTokenTtl` integer,
  `refreshTokenTtl` integer,
  `signingAlgorithm` text,
  `signingKeyId` text,
  `allowedScopes` text,
  `customClaims` text,
  `dpopBoundAccessTokensRequired` integer DEFAULT false NOT NULL,
  `disabled` integer DEFAULT false NOT NULL,
  `createdAt` integer,
  `updatedAt` integer,
  `policyVersion` integer DEFAULT 1 NOT NULL,
  `metadata` text
);
CREATE UNIQUE INDEX `oauthResource_identifier_unique` ON `oauthResource` (`identifier`);

CREATE TABLE `oauthClientResource` (
  `id` text PRIMARY KEY NOT NULL,
  `clientId` text NOT NULL,
  `resourceId` text NOT NULL,
  `metadata` text,
  `createdAt` integer,
  FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`resourceId`) REFERENCES `oauthResource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `oauth_client_resource_client_id_idx` ON `oauthClientResource` (`clientId`);
CREATE INDEX `oauth_client_resource_resource_id_idx` ON `oauthClientResource` (`resourceId`);
CREATE UNIQUE INDEX `oauth_client_resource_unique` ON `oauthClientResource` (`clientId`, `resourceId`);

CREATE TABLE `oauthRefreshToken` (
  `id` text PRIMARY KEY NOT NULL,
  `token` text NOT NULL,
  `clientId` text NOT NULL,
  `sessionId` text,
  `userId` text NOT NULL,
  `referenceId` text,
  `authorizationCodeId` text,
  `resources` text,
  `requestedUserInfoClaims` text,
  `expiresAt` integer NOT NULL,
  `createdAt` integer NOT NULL,
  `revoked` integer,
  `rotatedAt` integer,
  `rotationReplayResponse` text,
  `rotationReplayExpiresAt` integer,
  `authTime` integer,
  `confirmation` text,
  `scopes` text NOT NULL,
  FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `oauthRefreshToken_token_unique` ON `oauthRefreshToken` (`token`);
CREATE INDEX `oauth_refresh_token_client_id_idx` ON `oauthRefreshToken` (`clientId`);
CREATE INDEX `oauth_refresh_token_session_id_idx` ON `oauthRefreshToken` (`sessionId`);
CREATE INDEX `oauth_refresh_token_user_id_idx` ON `oauthRefreshToken` (`userId`);
CREATE INDEX `oauth_refresh_token_authorization_code_id_idx` ON `oauthRefreshToken` (`authorizationCodeId`);

CREATE TABLE `oauthAccessToken` (
  `id` text PRIMARY KEY NOT NULL,
  `token` text,
  `clientId` text NOT NULL,
  `sessionId` text,
  `userId` text,
  `referenceId` text,
  `authorizationCodeId` text,
  `resources` text,
  `requestedUserInfoClaims` text,
  `refreshId` text,
  `expiresAt` integer NOT NULL,
  `createdAt` integer NOT NULL,
  `revoked` integer,
  `confirmation` text,
  `scopes` text NOT NULL,
  FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`refreshId`) REFERENCES `oauthRefreshToken`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `oauthAccessToken_token_unique` ON `oauthAccessToken` (`token`);
CREATE INDEX `oauth_access_token_client_id_idx` ON `oauthAccessToken` (`clientId`);
CREATE INDEX `oauth_access_token_session_id_idx` ON `oauthAccessToken` (`sessionId`);
CREATE INDEX `oauth_access_token_user_id_idx` ON `oauthAccessToken` (`userId`);
CREATE INDEX `oauth_access_token_authorization_code_id_idx` ON `oauthAccessToken` (`authorizationCodeId`);
CREATE INDEX `oauth_access_token_refresh_id_idx` ON `oauthAccessToken` (`refreshId`);

CREATE TABLE `oauthConsent` (
  `id` text PRIMARY KEY NOT NULL,
  `clientId` text NOT NULL,
  `userId` text,
  `referenceId` text,
  `resources` text,
  `requestedUserInfoClaims` text,
  `scopes` text NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `oauth_consent_client_id_idx` ON `oauthConsent` (`clientId`);
CREATE INDEX `oauth_consent_user_id_idx` ON `oauthConsent` (`userId`);

CREATE TABLE `oauthClientAssertion` (
  `id` text PRIMARY KEY NOT NULL,
  `expiresAt` integer NOT NULL
);

CREATE TABLE `jwks` (
  `id` text PRIMARY KEY NOT NULL,
  `publicKey` text NOT NULL,
  `privateKey` text NOT NULL,
  `createdAt` integer NOT NULL,
  `expiresAt` integer,
  `alg` text,
  `crv` text
);
