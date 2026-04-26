ALTER TABLE `user`
ADD COLUMN `invited_by` text;

CREATE INDEX `user_invited_by_idx` ON `user`(`invited_by`);
