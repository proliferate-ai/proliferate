-- Add partial unique index for org-wide secrets.
-- The existing unique constraint secrets_org_repo_prebuild_key_unique on
-- (organization_id, repo_id, key, prebuild_id) doesn't enforce uniqueness when
-- repo_id and prebuild_id are NULL (Postgres treats NULLs as distinct).
-- This partial index closes that gap for org-scoped secrets.
CREATE UNIQUE INDEX IF NOT EXISTS "secrets_org_key_unique_when_org_wide"
  ON "secrets" ("organization_id", "key")
  WHERE "repo_id" IS NULL AND "prebuild_id" IS NULL;
