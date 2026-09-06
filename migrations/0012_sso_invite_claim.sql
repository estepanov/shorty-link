-- Correlate an SSO invite claim with the user activation in one D1 batch.

ALTER TABLE `admin_invite` ADD COLUMN `sso_claim_id` text;

-- Better Auth 1.7.3 does not populate account.issuer on its SSO path.
-- Keep the provider-id namespace used by the migration and account hook.
UPDATE `account`
SET `issuer` = 'local:' || `provider_id`
WHERE `issuer` = 'local:unknown';
