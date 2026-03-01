CREATE TABLE "workspace_cache_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repo_id" uuid NOT NULL,
	"repo_baseline_id" uuid,
	"repo_baseline_target_id" uuid,
	"cache_key" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"sandbox_provider" text,
	"metadata_json" jsonb,
	"created_by" text,
	"last_accessed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workspace_cache_snapshots_cache_key" UNIQUE("cache_key")
);
--> statement-breakpoint
ALTER TABLE "workspace_cache_snapshots" ADD CONSTRAINT "workspace_cache_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_cache_snapshots" ADD CONSTRAINT "workspace_cache_snapshots_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_cache_snapshots" ADD CONSTRAINT "workspace_cache_snapshots_repo_baseline_id_fkey" FOREIGN KEY ("repo_baseline_id") REFERENCES "public"."repo_baselines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_cache_snapshots" ADD CONSTRAINT "workspace_cache_snapshots_repo_baseline_target_id_fkey" FOREIGN KEY ("repo_baseline_target_id") REFERENCES "public"."repo_baseline_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_cache_snapshots" ADD CONSTRAINT "workspace_cache_snapshots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workspace_cache_snapshots_org" ON "workspace_cache_snapshots" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_workspace_cache_snapshots_repo" ON "workspace_cache_snapshots" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_workspace_cache_snapshots_baseline" ON "workspace_cache_snapshots" USING btree ("repo_baseline_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_workspace_cache_snapshots_baseline_target" ON "workspace_cache_snapshots" USING btree ("repo_baseline_target_id" uuid_ops);--> statement-breakpoint
ALTER TABLE "action_invocations" ADD CONSTRAINT "action_invocations_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'expired'::text, 'executing'::text, 'completed'::text, 'failed'::text]));--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_status_check" CHECK (status = ANY (ARRAY['validating'::text, 'ready'::text, 'stale'::text, 'failed'::text]));--> statement-breakpoint
ALTER TABLE "resume_intents" ADD CONSTRAINT "resume_intents_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'claimed'::text, 'resuming'::text, 'satisfied'::text, 'continued'::text, 'resume_failed'::text]));--> statement-breakpoint
ALTER TABLE "session_acl" ADD CONSTRAINT "session_acl_role_check" CHECK (role = ANY (ARRAY['viewer'::text, 'editor'::text, 'reviewer'::text]));--> statement-breakpoint
ALTER TABLE "session_capabilities" ADD CONSTRAINT "session_capabilities_mode_check" CHECK (mode = ANY (ARRAY['allow'::text, 'require_approval'::text, 'deny'::text]));--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_direction_check" CHECK (direction = ANY (ARRAY['user_to_manager'::text, 'user_to_task'::text, 'manager_to_task'::text, 'task_to_manager'::text]));--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_delivery_state_check" CHECK (delivery_state = ANY (ARRAY['queued'::text, 'delivered'::text, 'consumed'::text, 'failed'::text]));--> statement-breakpoint
ALTER TABLE "session_pull_requests" ADD CONSTRAINT "session_pull_requests_state_check" CHECK (pull_request_state IS NULL OR pull_request_state = ANY (ARRAY['open'::text, 'closed'::text, 'merged'::text, 'draft'::text]));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_kind_check" CHECK (kind = ANY (ARRAY['manager'::text, 'task'::text, 'setup'::text]));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_runtime_status_check" CHECK (runtime_status = ANY (ARRAY['starting'::text, 'running'::text, 'paused'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_operator_status_check" CHECK (operator_status = ANY (ARRAY['active'::text, 'waiting_for_approval'::text, 'needs_input'::text, 'ready_for_review'::text, 'errored'::text, 'done'::text]));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_visibility_v1_check" CHECK (visibility = ANY (ARRAY['private'::text, 'shared'::text, 'org'::text]));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_manager_worker_run_null_check" CHECK ((kind != 'manager'::text) OR (worker_run_id IS NULL));--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_source_check" CHECK (source = ANY (ARRAY['tick'::text, 'webhook'::text, 'manual'::text, 'manual_message'::text]));--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'claimed'::text, 'consumed'::text, 'coalesced'::text, 'cancelled'::text, 'failed'::text]));--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'health_degraded'::text]));--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_status_check" CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'degraded'::text, 'failed'::text]));
