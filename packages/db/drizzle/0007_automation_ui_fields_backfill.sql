-- Backfill automation UI / LLM configuration fields.
--
-- In some environments, 0005_automation_ui_fields was never applied due to
-- out-of-order migration history. This migration is intentionally idempotent
-- so it can be applied safely even if the schema is already up to date.

-- Automations: LLM filtering, analysis, and tool config
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "llm_filter_prompt" text;
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "enabled_tools" jsonb DEFAULT '{}';
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "llm_analysis_prompt" text;

-- Trigger events: enrichment and analysis result fields
ALTER TABLE "trigger_events" ADD COLUMN IF NOT EXISTS "enriched_data" jsonb;
ALTER TABLE "trigger_events" ADD COLUMN IF NOT EXISTS "llm_filter_result" jsonb;
ALTER TABLE "trigger_events" ADD COLUMN IF NOT EXISTS "llm_analysis_result" jsonb;

-- Trigger event actions: audit log for tool executions per event
CREATE TABLE IF NOT EXISTS "trigger_event_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trigger_event_id" uuid NOT NULL,
  "tool_name" text NOT NULL,
  "status" text DEFAULT 'pending',
  "input_data" jsonb,
  "output_data" jsonb,
  "error_message" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "duration_ms" integer,
  "created_at" timestamptz DEFAULT now()
);

-- Foreign keys
ALTER TABLE "trigger_event_actions"
  DROP CONSTRAINT IF EXISTS "trigger_event_actions_trigger_event_id_fkey";

ALTER TABLE "trigger_event_actions"
  ADD CONSTRAINT "trigger_event_actions_trigger_event_id_fkey"
  FOREIGN KEY ("trigger_event_id") REFERENCES "trigger_events"("id") ON DELETE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_trigger_event_actions_event" ON "trigger_event_actions" ("trigger_event_id");
CREATE INDEX IF NOT EXISTS "idx_trigger_event_actions_status" ON "trigger_event_actions" ("status");

