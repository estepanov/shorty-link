ALTER TABLE `redirect_event` ADD `aggregated` integer DEFAULT 0 NOT NULL;
CREATE INDEX `redirect_event_unaggregated_idx` ON `redirect_event` (`aggregated`, `created_at`);

CREATE TABLE `redirect_event_daily` (
	`link_id` text NOT NULL,
	`day` integer NOT NULL,
	`total` integer NOT NULL,
	PRIMARY KEY (`link_id`, `day`),
	FOREIGN KEY (`link_id`) REFERENCES `short_link`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `redirect_event_daily_day_idx` ON `redirect_event_daily` (`day`);

CREATE TABLE `redirect_event_dimension_daily` (
	`link_id` text NOT NULL,
	`day` integer NOT NULL,
	`dimension` text NOT NULL,
	`value` text NOT NULL,
	`total` integer NOT NULL,
	PRIMARY KEY (`link_id`, `day`, `dimension`, `value`),
	FOREIGN KEY (`link_id`) REFERENCES `short_link`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `redirect_event_dimension_daily_lookup_idx` ON `redirect_event_dimension_daily` (`link_id`, `dimension`, `day`);

CREATE TABLE `analytics_aggregation_state` (
	`id` text PRIMARY KEY NOT NULL,
	`last_success_at` integer NOT NULL,
	`locked_until` integer NOT NULL DEFAULT 0
);
