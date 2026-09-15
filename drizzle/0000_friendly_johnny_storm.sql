CREATE TABLE `conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`attribute_key` text NOT NULL,
	`observation_a_id` text NOT NULL,
	`observation_b_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_note` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`observation_a_id`) REFERENCES `observations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`observation_b_id`) REFERENCES `observations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_conflicts_status` ON `conflicts` (`status`);--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`code` text,
	`name` text,
	`start_year` integer,
	`end_year` integer,
	`facelift` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_generations_model_id` ON `generations` (`model_id`);--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`adapter` text NOT NULL,
	`status` text NOT NULL,
	`scope` text NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_runs_started_at` ON `ingestion_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `makes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country_code` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_makes_name` ON `makes` (`name`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`make_id` text NOT NULL,
	`name` text NOT NULL,
	`vehicle_type` text DEFAULT 'passenger_car' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`make_id`) REFERENCES `makes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_models_make_name` ON `models` (`make_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_models_make_id` ON `models` (`make_id`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`attribute_key` text NOT NULL,
	`value_text` text,
	`value_number` real,
	`unit` text,
	`source_id` text NOT NULL,
	`source_url` text,
	`market` text NOT NULL,
	`method` text NOT NULL,
	`effective_from` text,
	`effective_to` text,
	`retrieved_at` text NOT NULL,
	`confidence` integer NOT NULL,
	`raw_value` text,
	`checksum` text,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_observations_variant_attribute` ON `observations` (`variant_id`,`attribute_key`);--> statement-breakpoint
CREATE INDEX `idx_observations_source_id` ON `observations` (`source_id`);--> statement-breakpoint
CREATE TABLE `source_crosswalks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`external_id` text NOT NULL,
	`market` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crosswalk_source_external` ON `source_crosswalks` (`source_id`,`entity_type`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_crosswalk_entity` ON `source_crosswalks` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`geography` text NOT NULL,
	`license` text NOT NULL,
	`reuse_status` text NOT NULL,
	`access_mode` text NOT NULL,
	`authority_rank` integer NOT NULL,
	`coverage_tags` text NOT NULL,
	`homepage_url` text NOT NULL,
	`adapter_status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sources_authority_rank` ON `sources` (`authority_rank`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`generation_id` text,
	`market` text NOT NULL,
	`model_year` integer,
	`trim` text,
	`body_style` text,
	`powertrain` text,
	`transmission` text,
	`drive_type` text,
	`canonical_name` text NOT NULL,
	`completeness` integer DEFAULT 0 NOT NULL,
	`review_status` text DEFAULT 'identity_only' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_variants_market_year` ON `variants` (`market`,`model_year`);--> statement-breakpoint
CREATE INDEX `idx_variants_model_id` ON `variants` (`model_id`);--> statement-breakpoint
CREATE INDEX `idx_variants_canonical_name` ON `variants` (`canonical_name`);
--> statement-breakpoint
PRAGMA optimize;
