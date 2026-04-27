ALTER TABLE `redirect_event` ADD `user_agent_browser` text;
ALTER TABLE `redirect_event` ADD `user_agent_os` text;
ALTER TABLE `redirect_event` ADD `user_agent_device_type` text;
ALTER TABLE `redirect_event` ADD `user_agent_is_bot` integer;
CREATE INDEX `redirect_event_user_agent_browser_idx` ON `redirect_event` (`link_id`, `user_agent_browser`);
CREATE INDEX `redirect_event_user_agent_os_idx` ON `redirect_event` (`link_id`, `user_agent_os`);
CREATE INDEX `redirect_event_user_agent_device_type_idx` ON `redirect_event` (`link_id`, `user_agent_device_type`);
