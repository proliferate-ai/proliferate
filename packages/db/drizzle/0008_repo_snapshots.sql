-- Repo snapshot cache fields (Layer 2).
--
-- Stores a deterministic "repo snapshot" image ID that can be used as a fast baseline
-- for new sessions. This is provider-specific (Modal in v1) and built asynchronously.

ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "repo_snapshot_id" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "repo_snapshot_status" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "repo_snapshot_error" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "repo_snapshot_commit_sha" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "repo_snapshot_built_at" timestamptz;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "repo_snapshot_provider" text;

CREATE INDEX IF NOT EXISTS "idx_repos_repo_snapshot_status" ON "repos" ("repo_snapshot_status");

