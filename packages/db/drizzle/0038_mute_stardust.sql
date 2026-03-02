CREATE TABLE "action_invocation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_invocation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_baseline_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_baseline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"status" text DEFAULT 'validating' NOT NULL,
	"version" text,
	"snapshot_id" text,
	"sandbox_provider" text,
	"setup_session_id" uuid,
	"install_commands" jsonb,
	"run_commands" jsonb,
	"test_commands" jsonb,
	"service_commands" jsonb,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_session_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload_json" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session_acl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_acl_session_user" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"capability_key" text NOT NULL,
	"mode" text DEFAULT 'allow' NOT NULL,
	"scope" jsonb,
	"origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_capabilities_session_key" UNIQUE("session_id","capability_key")
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"message_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"delivery_state" text DEFAULT 'queued' NOT NULL,
	"dedupe_key" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deliver_after" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"sender_user_id" text,
	"sender_session_id" uuid
);
--> statement-breakpoint
CREATE TABLE "session_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"branch_name" text NOT NULL,
	"provider" text NOT NULL,
	"pull_request_number" integer,
	"pull_request_url" text,
	"pull_request_state" text,
	"head_commit_sha" text,
	"continued_from_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"config_json" jsonb,
	"origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_skills_session_key" UNIQUE("session_id","skill_key")
);
--> statement-breakpoint
CREATE TABLE "session_user_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_user_state_session_user" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "wake_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"coalesced_into_wake_event_id" uuid,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worker_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_run_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"event_index" integer NOT NULL,
	"event_type" text NOT NULL,
	"summary_text" text,
	"payload_json" jsonb,
	"payload_version" integer DEFAULT 1,
	"session_id" uuid,
	"action_invocation_id" uuid,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_worker_run_events_run_index" UNIQUE("worker_run_id","event_index")
);
--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"manager_session_id" uuid NOT NULL,
	"wake_event_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uq_worker_runs_wake_event" UNIQUE("wake_event_id")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"status" text DEFAULT 'active' NOT NULL,
	"manager_session_id" uuid NOT NULL,
	"model_id" text,
	"compute_profile" text,
	"last_wake_at" timestamp with time zone,
	"last_completed_run_at" timestamp with time zone,
	"last_error_code" text,
	"paused_at" timestamp with time zone,
	"paused_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" text DEFAULT 'task';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "runtime_status" text DEFAULT 'starting';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "operator_status" text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "visibility" text DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "worker_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "worker_run_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "repo_baseline_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "repo_baseline_target_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "capabilities_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "continued_from_session_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "rerun_of_session_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "replaces_session_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "replaced_by_session_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_visible_update_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "outcome_json" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "outcome_version" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "outcome_persisted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "action_invocation_events" ADD CONSTRAINT "action_invocation_events_action_invocation_id_fkey" FOREIGN KEY ("action_invocation_id") REFERENCES "public"."action_invocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baseline_targets" ADD CONSTRAINT "repo_baseline_targets_repo_baseline_id_fkey" FOREIGN KEY ("repo_baseline_id") REFERENCES "public"."repo_baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_setup_session_id_fkey" FOREIGN KEY ("setup_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_intents" ADD CONSTRAINT "resume_intents_origin_session_id_fkey" FOREIGN KEY ("origin_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_intents" ADD CONSTRAINT "resume_intents_invocation_id_fkey" FOREIGN KEY ("invocation_id") REFERENCES "public"."action_invocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_acl" ADD CONSTRAINT "session_acl_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_acl" ADD CONSTRAINT "session_acl_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_capabilities" ADD CONSTRAINT "session_capabilities_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pull_requests" ADD CONSTRAINT "session_pull_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pull_requests" ADD CONSTRAINT "session_pull_requests_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pull_requests" ADD CONSTRAINT "session_pull_requests_continued_from_session_id_fkey" FOREIGN KEY ("continued_from_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_skills" ADD CONSTRAINT "session_skills_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_user_state" ADD CONSTRAINT "session_user_state_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_user_state" ADD CONSTRAINT "session_user_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_coalesced_into_wake_event_id_fkey" FOREIGN KEY ("coalesced_into_wake_event_id") REFERENCES "public"."wake_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_run_events" ADD CONSTRAINT "worker_run_events_worker_run_id_fkey" FOREIGN KEY ("worker_run_id") REFERENCES "public"."worker_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_run_events" ADD CONSTRAINT "worker_run_events_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_manager_session_id_fkey" FOREIGN KEY ("manager_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_wake_event_id_fkey" FOREIGN KEY ("wake_event_id") REFERENCES "public"."wake_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_manager_session_id_fkey" FOREIGN KEY ("manager_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_action_invocation_events_invocation" ON "action_invocation_events" USING btree ("action_invocation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_action_invocation_events_type" ON "action_invocation_events" USING btree ("event_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_repo_baseline_targets_baseline" ON "repo_baseline_targets" USING btree ("repo_baseline_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_repo_baselines_repo" ON "repo_baselines" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_repo_baselines_one_active_per_repo" ON "repo_baselines" USING btree ("repo_id") WHERE status = 'ready';--> statement-breakpoint
CREATE INDEX "idx_resume_intents_origin_session" ON "resume_intents" USING btree ("origin_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_resume_intents_invocation" ON "resume_intents" USING btree ("invocation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_resume_intents_status" ON "resume_intents" USING btree ("status" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_resume_intents_one_active" ON "resume_intents" USING btree ("origin_session_id","invocation_id") WHERE status NOT IN ('satisfied', 'continued', 'resume_failed');--> statement-breakpoint
CREATE INDEX "idx_session_acl_session" ON "session_acl" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_acl_user" ON "session_acl" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_session_capabilities_session" ON "session_capabilities" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_messages_session" ON "session_messages" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_messages_delivery_state" ON "session_messages" USING btree ("delivery_state" text_ops);--> statement-breakpoint
CREATE INDEX "idx_session_messages_session_state" ON "session_messages" USING btree ("session_id" uuid_ops,"delivery_state" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_messages_dedupe" ON "session_messages" USING btree ("session_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_session_pull_requests_session" ON "session_pull_requests" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_pull_requests_repo" ON "session_pull_requests" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_skills_session" ON "session_skills" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_user_state_session" ON "session_user_state" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_user_state_user" ON "session_user_state" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_worker" ON "wake_events" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_status" ON "wake_events" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_worker_status" ON "wake_events" USING btree ("worker_id" uuid_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_org" ON "wake_events" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_run_events_run" ON "worker_run_events" USING btree ("worker_run_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_run_events_worker" ON "worker_run_events" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_worker_run_events_dedupe" ON "worker_run_events" USING btree ("worker_run_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_worker_runs_worker" ON "worker_runs" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_runs_status" ON "worker_runs" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_runs_org" ON "worker_runs" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_worker_runs_one_active_per_worker" ON "worker_runs" USING btree ("worker_id") WHERE status NOT IN ('completed', 'failed', 'cancelled', 'health_degraded');--> statement-breakpoint
CREATE INDEX "idx_workers_org" ON "workers" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_workers_status" ON "workers" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_workers_manager_session" ON "workers" USING btree ("manager_session_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workers_manager_session" ON "workers" USING btree ("manager_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_kind" ON "sessions" USING btree ("kind" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_runtime_status" ON "sessions" USING btree ("runtime_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_operator_status" ON "sessions" USING btree ("operator_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_worker" ON "sessions" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_worker_run" ON "sessions" USING btree ("worker_run_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_one_active_setup_per_repo" ON "sessions" USING btree ("repo_id") WHERE kind = 'setup' AND runtime_status NOT IN ('completed', 'failed', 'cancelled');--> statement-breakpoint
