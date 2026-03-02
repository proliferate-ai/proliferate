-- V1 Bridge: Add optional worker_id to automations.
-- When set, trigger events create wake_events(source=webhook) instead of automation_runs.
ALTER TABLE "automations" ADD COLUMN "worker_id" uuid;
CREATE INDEX IF NOT EXISTS "idx_automations_worker_id" ON "automations" ("worker_id");
