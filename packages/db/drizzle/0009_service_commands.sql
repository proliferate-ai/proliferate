-- Per-repo service commands for auto-starting dev servers.
--
-- Stores an array of {name, command, cwd?} objects that run after sandbox init
-- when the snapshot includes installed dependencies (prebuild/session snapshots).

ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "service_commands" jsonb;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "service_commands_updated_at" timestamptz;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "service_commands_updated_by" text;
