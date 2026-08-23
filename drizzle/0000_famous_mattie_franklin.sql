CREATE TABLE `gacha_records` (
	`owner_key` text NOT NULL,
	`game` text NOT NULL,
	`uid` text NOT NULL,
	`record_id` text NOT NULL,
	`pool_type` text NOT NULL,
	`item_id` text NOT NULL,
	`item_name` text NOT NULL,
	`item_type` text NOT NULL,
	`rarity` integer NOT NULL,
	`pulled_at` text NOT NULL,
	`server_id` text,
	`raw_json` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `game`, `uid`, `record_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_gacha_records_account_time` ON `gacha_records` (`owner_key`,`game`,`uid`,`pulled_at`);--> statement-breakpoint
CREATE INDEX `idx_gacha_records_account_pool` ON `gacha_records` (`owner_key`,`game`,`uid`,`pool_type`);--> statement-breakpoint
CREATE TABLE `upload_batches` (
	`owner_key` text NOT NULL,
	`game` text NOT NULL,
	`uid` text NOT NULL,
	`source` text NOT NULL,
	`last_count` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `game`, `uid`)
);
