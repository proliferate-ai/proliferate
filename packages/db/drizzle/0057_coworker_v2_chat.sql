-- Coworker V2: Persistent chat model
-- Workers table: add description, rename objective→system_prompt, drop V1 columns, update status CHECK
-- Worker jobs: new table for scheduled check-in prompts
-- Session events: expand CHECK for chat event types, add composite index

-- 1. Workers table evolution
ALTER TABLE "workers" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "workers" RENAME COLUMN "objective" TO "system_prompt";--> statement-breakpoint
ALTER TABLE "workers" DROP COLUMN "last_wake_at";--> statement-breakpoint
ALTER TABLE "workers" DROP COLUMN "last_completed_run_at";--> statement-breakpoint
UPDATE "workers" SET "status" = 'automations_paused' WHERE "status" = 'paused';--> statement-breakpoint
ALTER TABLE "workers" DROP CONSTRAINT "workers_status_check";--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_status_check"
  CHECK (status = ANY (ARRAY['active'::text, 'automations_paused'::text, 'degraded'::text, 'failed'::text, 'archived'::text]));--> statement-breakpoint

-- 2. Worker jobs table (new)
CREATE TABLE "worker_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "worker_id" uuid NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "check_in_prompt" text NOT NULL,
  "cron_expression" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_tick_at" timestamp with time zone,
  "next_tick_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "idx_worker_jobs_worker" ON "worker_jobs" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "idx_worker_jobs_org" ON "worker_jobs" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;--> statement-breakpoint

-- 3. Expand session_events CHECK for chat types
ALTER TABLE "session_events" DROP CONSTRAINT "session_events_type_check";--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_type_check"
  CHECK (event_type = ANY (ARRAY['session_created'::text, 'session_started'::text, 'session_paused'::text, 'session_resumed'::text, 'session_completed'::text, 'session_failed'::text, 'session_cancelled'::text, 'session_outcome_persisted'::text, 'runtime_tool_started'::text, 'runtime_tool_finished'::text, 'runtime_approval_requested'::text, 'runtime_approval_resolved'::text, 'runtime_action_completed'::text, 'runtime_error'::text, 'chat_user_message'::text, 'chat_agent_response'::text, 'chat_job_tick'::text, 'chat_system'::text]));--> statement-breakpoint

-- 4. Composite index for chat history queries
CREATE INDEX "idx_session_events_chat_history" ON "session_events" USING btree ("session_id", "event_type", "created_at");
