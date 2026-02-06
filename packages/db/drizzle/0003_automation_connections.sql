-- Add automation_connections table and session dedup index

CREATE TABLE IF NOT EXISTS "automation_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "automation_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_automation_connections_automation" ON "automation_connections" ("automation_id");
CREATE INDEX IF NOT EXISTS "idx_automation_connections_integration" ON "automation_connections" ("integration_id");

ALTER TABLE "automation_connections"
  DROP CONSTRAINT IF EXISTS "automation_connections_automation_id_fkey";

ALTER TABLE "automation_connections"
  ADD CONSTRAINT "automation_connections_automation_id_fkey"
  FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE;

ALTER TABLE "automation_connections"
  DROP CONSTRAINT IF EXISTS "automation_connections_integration_id_fkey";

ALTER TABLE "automation_connections"
  ADD CONSTRAINT "automation_connections_integration_id_fkey"
  FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE;

ALTER TABLE "automation_connections"
  DROP CONSTRAINT IF EXISTS "automation_connections_automation_id_integration_id_key";

ALTER TABLE "automation_connections"
  ADD CONSTRAINT "automation_connections_automation_id_integration_id_key"
  UNIQUE ("automation_id", "integration_id");

ALTER TABLE "sessions"
  DROP CONSTRAINT IF EXISTS "idx_sessions_automation_trigger_event";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_sessions_automation_trigger_event"
  ON "sessions" ("automation_id", "trigger_event_id");
