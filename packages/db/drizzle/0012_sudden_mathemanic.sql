CREATE TABLE "sandbox_base_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_key" text NOT NULL,
	"snapshot_id" text,
	"status" text DEFAULT 'building' NOT NULL,
	"error" text,
	"provider" text DEFAULT 'modal' NOT NULL,
	"modal_app_name" text NOT NULL,
	"built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sandbox_base_snapshots_status_check" CHECK (status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "trigger_event_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_event_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"status" text DEFAULT 'pending',
	"input_data" jsonb,
	"output_data" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "llm_filter_prompt" text;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "enabled_tools" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "llm_analysis_prompt" text;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "service_commands" jsonb;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "service_commands_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "service_commands_updated_by" text;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "env_files" jsonb;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "env_files_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "env_files_updated_by" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "repo_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "repo_snapshot_status" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "repo_snapshot_error" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "repo_snapshot_commit_sha" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "repo_snapshot_built_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "repo_snapshot_provider" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "service_commands" jsonb;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "service_commands_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "service_commands_updated_by" text;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD COLUMN "enriched_data" jsonb;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD COLUMN "llm_filter_result" jsonb;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD COLUMN "llm_analysis_result" jsonb;--> statement-breakpoint
ALTER TABLE "trigger_event_actions" ADD CONSTRAINT "trigger_event_actions_trigger_event_id_fkey" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."trigger_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sandbox_base_snapshots_version_provider_app" ON "sandbox_base_snapshots" USING btree ("version_key" text_ops,"provider" text_ops,"modal_app_name" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sandbox_base_snapshots_status" ON "sandbox_base_snapshots" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_trigger_event_actions_event" ON "trigger_event_actions" USING btree ("trigger_event_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_trigger_event_actions_status" ON "trigger_event_actions" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_repos_repo_snapshot_status" ON "repos" USING btree ("repo_snapshot_status" text_ops);