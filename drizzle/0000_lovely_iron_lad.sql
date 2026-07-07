CREATE TABLE `rate_limits` (
	`scope` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_urls` (
	`url_hash` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_generated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_access_status` text NOT NULL,
	`generate_count` integer DEFAULT 1 NOT NULL
);
