CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_audit_events` (
	`id` text PRIMARY KEY,
	`admin_user_id` text NOT NULL,
	`admin_email` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`result` text NOT NULL,
	`status` integer NOT NULL,
	`message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_skills` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`owner_user_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`runtime_scope` text NOT NULL,
	`origin` text NOT NULL,
	`source_id` text,
	`source_hash` text,
	`content_hash` text NOT NULL,
	`default_enabled` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `bot_routines` (
	`id` text PRIMARY KEY,
	`bot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`cadence_json` text NOT NULL,
	`prompt` text NOT NULL,
	`until` integer,
	`watch_json` text DEFAULT '{"kind":"none"}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`session_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cron_runs` (
	`id` text PRIMARY KEY,
	`job_id` text NOT NULL,
	`cron` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`actor_user_id` text,
	`actor_email` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `global_secrets` (
	`key` text PRIMARY KEY,
	`encrypted_value` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcpcf_config` (
	`id` text PRIMARY KEY,
	`enabled` integer DEFAULT 0 NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`admin_api_token_secret_key` text DEFAULT 'mcpcf.admin-api-token' NOT NULL,
	`user_oauth_provider_id` text DEFAULT '' NOT NULL,
	`expected_issuer` text,
	`auth_type_allowlist_json` text DEFAULT '[]' NOT NULL,
	`server_blacklist_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcpcf_servers` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`auth_type` text,
	`tool_count` integer DEFAULT 0 NOT NULL,
	`tools_json` text DEFAULT '[]' NOT NULL,
	`source_status` text DEFAULT 'active' NOT NULL,
	`filter_reason` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`raw_metadata_json` text DEFAULT '{}' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`verified_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_metadata` (
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`description` text,
	`aliases` text,
	`channel_associations` text,
	`keywords` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `repo_metadata_pk` PRIMARY KEY(`repo_owner`, `repo_name`)
);
--> statement-breakpoint
CREATE TABLE `repo_secrets` (
	`repo_id` integer NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`key` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `repo_secrets_pk` PRIMARY KEY(`repo_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`expiresAt` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`title` text,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`github_installation_id` integer,
	`github_repo_id` integer,
	`repo_default_branch` text,
	`branch_name` text,
	`tools_json` text DEFAULT '[]' NOT NULL,
	`custom_mcp_json` text DEFAULT '{}' NOT NULL,
	`secret_keys_json` text DEFAULT '[]' NOT NULL,
	`isolate_step_limit` integer DEFAULT 50 NOT NULL,
	`subagents` text DEFAULT 'enabled' NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text,
	`session_kind` text DEFAULT 'isolate' NOT NULL,
	`agent_runtime` text DEFAULT 'isolate' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`incognito` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT 0 NOT NULL,
	`image` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_agent_skill_preferences` (
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `user_agent_skill_preferences_pk` PRIMARY KEY(`user_id`, `skill_id`),
	CONSTRAINT `fk_user_agent_skill_preferences_skill_id_agent_skills_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `agent_skills`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user_api_keys` (
	`key_id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`label` text,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `user_mcpcf_server_configs` (
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`auth_token_secret_key` text,
	`default_tools_enabled` integer DEFAULT 1 NOT NULL,
	`disabled_tools_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `user_mcpcf_server_configs_pk` PRIMARY KEY(`user_id`, `server_id`)
);
--> statement-breakpoint
CREATE TABLE `user_provider_configs` (
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`scope` text NOT NULL,
	`display_name` text NOT NULL,
	`npm` text,
	`provider_json` text NOT NULL,
	`api_key_encrypted` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `user_provider_configs_pk` PRIMARY KEY(`user_id`, `provider_id`)
);
--> statement-breakpoint
CREATE TABLE `user_provider_preferences` (
	`user_id` text PRIMARY KEY,
	`default_model` text,
	`default_isolate_step_limit` integer DEFAULT 50 NOT NULL,
	`opencode_permission_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_run_events` (
	`id` text PRIMARY KEY,
	`workflow_id` text NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`node_id` text,
	`event_type` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY,
	`workflow_id` text NOT NULL,
	`workflow_version` integer NOT NULL,
	`workflow_instance_id` text,
	`user_id` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`trigger_node_id` text,
	`status` text NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text,
	`error` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_session_reuse_keys` (
	`user_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`node_id` text NOT NULL,
	`session_kind` text NOT NULL,
	`key_hash` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `workflow_session_reuse_keys_pk` PRIMARY KEY(`user_id`, `workflow_id`, `node_id`, `session_kind`, `key_hash`)
);
--> statement-breakpoint
CREATE TABLE `workflow_slack_apps` (
	`id` text PRIMARY KEY,
	`workflow_id` text NOT NULL,
	`user_id` text NOT NULL,
	`app_name` text NOT NULL,
	`signing_secret_key` text NOT NULL,
	`bot_token_secret_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_slack_deliveries` (
	`id` text PRIMARY KEY,
	`slack_app_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`node_id` text NOT NULL,
	`delivery_key` text NOT NULL,
	`surface` text NOT NULL,
	`run_id` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_slack_trigger_registrations` (
	`id` text PRIMARY KEY,
	`slack_app_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_version` integer NOT NULL,
	`node_id` text NOT NULL,
	`surface` text NOT NULL,
	`command_name` text,
	`event_types_json` text DEFAULT '[]' NOT NULL,
	`channel_name_pattern` text,
	`keyword_rules_json` text DEFAULT '[]' NOT NULL,
	`action_ids_json` text DEFAULT '[]' NOT NULL,
	`cooldown_seconds` integer DEFAULT 0 NOT NULL,
	`dedupe_window_seconds` integer DEFAULT 300 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`manifest_version` integer NOT NULL,
	`manifest_key` text NOT NULL,
	`code_key` text NOT NULL,
	`webhook_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_account_provider_account` ON `account` (`providerId`,`accountId`);--> statement-breakpoint
CREATE INDEX `idx_account_userId` ON `account` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_admin_audit_events_created` ON `admin_audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_audit_events_target` ON `admin_audit_events` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_skills_active_global_slug` ON `agent_skills` (`slug`) WHERE scope = 'global' AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_skills_active_user_slug` ON `agent_skills` (`owner_user_id`,`slug`) WHERE scope = 'user' AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `idx_agent_skills_active_scope_runtime` ON `agent_skills` (`scope`,`runtime_scope`,`default_enabled`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_bot_routines_bot_updated` ON `bot_routines` (`bot_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_bot_routines_owner_updated` ON `bot_routines` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_bots_owner_updated` ON `bots` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_bots_session` ON `bots` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_cron_runs_job_created` ON `cron_runs` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_runs_job_status_created` ON `cron_runs` (`job_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcpcf_servers_slug` ON `mcpcf_servers` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_mcpcf_servers_status_enabled` ON `mcpcf_servers` (`source_status`,`enabled`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_repo_secrets_repo_name` ON `repo_secrets` (`repo_owner`,`repo_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_token` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `idx_session_userId` ON `session` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_sessions_status_updated` ON `sessions` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_repo` ON `sessions` (`user_id`,`repo_owner`,`repo_name`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_email` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `idx_user_agent_skill_preferences_skill` ON `user_agent_skill_preferences` (`skill_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_api_keys_owner` ON `user_api_keys` (`user_id`,`revoked_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_user_mcpcf_server_configs_user` ON `user_mcpcf_server_configs` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_user_provider_configs_user_scope` ON `user_provider_configs` (`user_id`,`scope`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_verification_identifier` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_events_run_sequence` ON `workflow_run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_workflow_run_events_workflow_created` ON `workflow_run_events` (`workflow_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_workflow_updated` ON `workflow_runs` (`workflow_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_workflow_session_reuse_keys_session` ON `workflow_session_reuse_keys` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_slack_apps_workflow` ON `workflow_slack_apps` (`workflow_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_slack_apps_owner` ON `workflow_slack_apps` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_slack_deliveries_dedupe` ON `workflow_slack_deliveries` (`slack_app_id`,`node_id`,`delivery_key`);--> statement-breakpoint
CREATE INDEX `idx_workflow_slack_deliveries_node_created` ON `workflow_slack_deliveries` (`slack_app_id`,`node_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_slack_trigger_node` ON `workflow_slack_trigger_registrations` (`workflow_id`,`node_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_slack_trigger_app_surface` ON `workflow_slack_trigger_registrations` (`slack_app_id`,`surface`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_workflow_slack_trigger_workflow` ON `workflow_slack_trigger_registrations` (`workflow_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_workflows_owner_updated` ON `workflows` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflows_webhook_id` ON `workflows` (`webhook_id`);