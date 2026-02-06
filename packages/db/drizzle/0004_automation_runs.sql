-- Add automation_runs, automation_run_events, automation_side_effects, outbox tables

CREATE TABLE IF NOT EXISTS "automation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "automation_id" uuid NOT NULL,
  "trigger_event_id" uuid NOT NULL,
  "trigger_id" uuid,
  "status" text DEFAULT 'queued' NOT NULL,
  "status_reason" text,
  "failure_stage" text,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  "lease_version" integer DEFAULT 0 NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "queued_at" timestamptz DEFAULT now() NOT NULL,
  "enrichment_started_at" timestamptz,
  "enrichment_completed_at" timestamptz,
  "execution_started_at" timestamptz,
  "prompt_sent_at" timestamptz,
  "completed_at" timestamptz,
  "last_activity_at" timestamptz,
  "deadline_at" timestamptz,
  "session_id" uuid,
  "session_created_at" timestamptz,
  "completion_id" text,
  "completion_json" jsonb,
  "completion_artifact_ref" text,
  "enrichment_artifact_ref" text,
  "sources_artifact_ref" text,
  "policy_artifact_ref" text,
  "error_code" text,
  "error_message" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_automation_runs_status_lease" ON "automation_runs" ("status", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "idx_automation_runs_org_status" ON "automation_runs" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "idx_automation_runs_session" ON "automation_runs" ("session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_automation_runs_trigger_event" ON "automation_runs" ("trigger_event_id");

ALTER TABLE "automation_runs"
  DROP CONSTRAINT IF EXISTS "automation_runs_organization_id_fkey";

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;

ALTER TABLE "automation_runs"
  DROP CONSTRAINT IF EXISTS "automation_runs_automation_id_fkey";

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_automation_id_fkey"
  FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE;

ALTER TABLE "automation_runs"
  DROP CONSTRAINT IF EXISTS "automation_runs_trigger_event_id_fkey";

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_trigger_event_id_fkey"
  FOREIGN KEY ("trigger_event_id") REFERENCES "trigger_events"("id") ON DELETE CASCADE;

ALTER TABLE "automation_runs"
  DROP CONSTRAINT IF EXISTS "automation_runs_trigger_id_fkey";

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_trigger_id_fkey"
  FOREIGN KEY ("trigger_id") REFERENCES "triggers"("id") ON DELETE SET NULL;

ALTER TABLE "automation_runs"
  DROP CONSTRAINT IF EXISTS "automation_runs_session_id_fkey";

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "automation_run_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "type" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "data" jsonb,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_automation_run_events_run" ON "automation_run_events" ("run_id", "created_at" DESC);

ALTER TABLE "automation_run_events"
  DROP CONSTRAINT IF EXISTS "automation_run_events_run_id_fkey";

ALTER TABLE "automation_run_events"
  ADD CONSTRAINT "automation_run_events_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "automation_side_effects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "organization_id" text NOT NULL,
  "effect_id" text NOT NULL,
  "kind" text NOT NULL,
  "provider" text,
  "request_hash" text,
  "response_json" jsonb,
  "created_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "automation_side_effects_org_effect_key" ON "automation_side_effects" ("organization_id", "effect_id");
CREATE INDEX IF NOT EXISTS "idx_automation_side_effects_run" ON "automation_side_effects" ("run_id");

ALTER TABLE "automation_side_effects"
  DROP CONSTRAINT IF EXISTS "automation_side_effects_run_id_fkey";

ALTER TABLE "automation_side_effects"
  ADD CONSTRAINT "automation_side_effects_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE;

ALTER TABLE "automation_side_effects"
  DROP CONSTRAINT IF EXISTS "automation_side_effects_organization_id_fkey";

ALTER TABLE "automation_side_effects"
  ADD CONSTRAINT "automation_side_effects_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now(),
  "last_error" text,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_outbox_status_available" ON "outbox" ("status", "available_at");

ALTER TABLE "outbox"
  DROP CONSTRAINT IF EXISTS "outbox_organization_id_fkey";

ALTER TABLE "outbox"
  ADD CONSTRAINT "outbox_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
