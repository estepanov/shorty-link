-- Correlate an SSO invite claim with the user activation in one D1 batch.

ALTER TABLE `admin_invite` ADD COLUMN `sso_claim_id` text;

-- Claiming an invite and activating its staged Better Auth user must be one
-- database operation. If the staged user no longer matches, aborting from the
-- trigger rolls the invite update back instead of leaving a half-applied claim.
CREATE TRIGGER `admin_invite_sso_claim_activate`
AFTER UPDATE OF `sso_claim_id` ON `admin_invite`
WHEN NEW.`sso_claim_id` IS NOT NULL
	AND OLD.`sso_claim_id` IS NULL
BEGIN
	UPDATE `user`
	SET
		`role_id` = NEW.`role_id`,
		`invited_by` = NEW.`invited_by`,
		`is_active` = 1,
		`updated_at` = unixepoch()
	WHERE `id` = NEW.`sso_claim_id`
		AND `email` = NEW.`email`
		AND `is_active` = 0;

	SELECT CASE
		WHEN changes() != 1 THEN RAISE(ABORT, 'sso invite activation failed')
	END;
END;

-- Better Auth 1.7.3 does not populate account.issuer on its SSO path.
-- Keep the provider-id namespace used by the migration and account hook.
UPDATE `account`
SET `issuer` = 'local:' || `provider_id`
WHERE `issuer` = 'local:unknown';
