ALTER TABLE `managed_domain`
ADD COLUMN `root_behavior` text DEFAULT 'landing' NOT NULL;

ALTER TABLE `managed_domain`
ADD COLUMN `root_redirect_status_code` integer;

ALTER TABLE `managed_domain`
ADD COLUMN `root_redirect_target_url` text;

ALTER TABLE `managed_domain`
ADD COLUMN `unknown_slug_behavior` text DEFAULT 'not_found' NOT NULL;

ALTER TABLE `managed_domain`
ADD COLUMN `unknown_slug_redirect_status_code` integer;

ALTER TABLE `managed_domain`
ADD COLUMN `unknown_slug_redirect_target_url` text;
