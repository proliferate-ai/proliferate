-- PR2 Contract: Rename prebuilds → configurations, drop old columns/tables.
-- Depends on 0024_configurations_snapshots_expand.sql (all data already migrated).

-- ============================================
-- 1. Drop secret_bundles (FK from secrets.bundle_id must go first)
-- ============================================

ALTER TABLE "secrets" DROP COLUMN IF EXISTS "bundle_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "secret_bundles";
--> statement-breakpoint

-- ============================================
-- 2. Drop CLI tables
-- ============================================

DROP TABLE IF EXISTS "user_ssh_keys";
--> statement-breakpoint
DROP TABLE IF EXISTS "cli_device_codes";
--> statement-breakpoint
DROP TABLE IF EXISTS "cli_github_selections";
--> statement-breakpoint

-- ============================================
-- 3. Drop has_deps from snapshots
-- ============================================

ALTER TABLE "snapshots" DROP COLUMN IF EXISTS "has_deps";
--> statement-breakpoint

-- ============================================
-- 4. Drop repo snapshot columns from repos
-- ============================================

ALTER TABLE "repos" DROP COLUMN IF EXISTS "repo_snapshot_id";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "repo_snapshot_status";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "repo_snapshot_provider";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "repo_snapshot_commit_sha";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "repo_snapshot_error";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "repo_snapshot_built_at";
--> statement-breakpoint

-- ============================================
-- 5. Drop repo service/setup columns from repos
-- ============================================

ALTER TABLE "repos" DROP COLUMN IF EXISTS "service_commands";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "service_commands_updated_at";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "service_commands_updated_by";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "setup_commands";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "detected_stack";
--> statement-breakpoint

-- ============================================
-- 6. Drop other repo columns
-- ============================================

ALTER TABLE "repos" DROP COLUMN IF EXISTS "is_orphaned";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "source";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "local_path_hash";
--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN IF EXISTS "added_by";
--> statement-breakpoint
ALTER TABLE "repos" DROP CONSTRAINT IF EXISTS "repos_source_check";
--> statement-breakpoint

-- ============================================
-- 7. Rename prebuilds → configurations
-- ============================================

-- Drop old constraints first
ALTER TABLE "prebuilds" DROP CONSTRAINT IF EXISTS "prebuilds_user_path_unique";
--> statement-breakpoint
ALTER TABLE "prebuilds" DROP CONSTRAINT IF EXISTS "prebuilds_cli_requires_path";
--> statement-breakpoint

-- Drop FK constraints referencing prebuilds (will re-add with new names)
ALTER TABLE "snapshots" DROP CONSTRAINT IF EXISTS "snapshots_prebuild_id_fkey";
--> statement-breakpoint
ALTER TABLE "secret_files" DROP CONSTRAINT IF EXISTS "secret_files_prebuild_id_fkey";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_prebuild_id_fkey";
--> statement-breakpoint
ALTER TABLE "prebuild_repos" DROP CONSTRAINT IF EXISTS "prebuild_repos_prebuild_id_fkey";
--> statement-breakpoint
ALTER TABLE "prebuild_repos" DROP CONSTRAINT IF EXISTS "prebuild_repos_repo_id_fkey";
--> statement-breakpoint
ALTER TABLE "prebuild_repos" DROP CONSTRAINT IF EXISTS "prebuild_repos_pkey";
--> statement-breakpoint
ALTER TABLE "prebuilds" DROP CONSTRAINT IF EXISTS "prebuilds_organization_id_fkey";
--> statement-breakpoint
ALTER TABLE "prebuilds" DROP CONSTRAINT IF EXISTS "prebuilds_active_snapshot_id_snapshots_id_fk";
--> statement-breakpoint

-- Rename the table
ALTER TABLE "prebuilds" RENAME TO "configurations";
--> statement-breakpoint

-- ============================================
-- 8. Drop old columns from configurations
-- ============================================

ALTER TABLE "configurations" DROP COLUMN IF EXISTS "snapshot_id";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "status";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "error";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "type";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "local_path_hash";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "created_by";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "env_files";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "env_files_updated_at";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "env_files_updated_by";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "connectors";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "connectors_updated_at";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "connectors_updated_by";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "service_commands_updated_at";
--> statement-breakpoint
ALTER TABLE "configurations" DROP COLUMN IF EXISTS "service_commands_updated_by";
--> statement-breakpoint

-- Rename notes → description
ALTER TABLE "configurations" RENAME COLUMN "notes" TO "description";
--> statement-breakpoint

-- Add updated_at (never existed on prebuilds)
ALTER TABLE "configurations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint

-- ============================================
-- 9. Rename prebuild_repos → configuration_repos
-- ============================================

ALTER TABLE "prebuild_repos" RENAME TO "configuration_repos";
--> statement-breakpoint
ALTER TABLE "configuration_repos" RENAME COLUMN "prebuild_id" TO "configuration_id";
--> statement-breakpoint

-- ============================================
-- 10. Rename FK columns on dependent tables
-- ============================================

-- snapshots: prebuild_id → configuration_id
ALTER TABLE "snapshots" RENAME COLUMN "prebuild_id" TO "configuration_id";
--> statement-breakpoint

-- secret_files: prebuild_id → configuration_id
ALTER TABLE "secret_files" RENAME COLUMN "prebuild_id" TO "configuration_id";
--> statement-breakpoint

-- sessions: prebuild_id → configuration_id
ALTER TABLE "sessions" RENAME COLUMN "prebuild_id" TO "configuration_id";
--> statement-breakpoint

-- automations: default_prebuild_id → default_configuration_id
ALTER TABLE "automations" RENAME COLUMN "default_prebuild_id" TO "default_configuration_id";
--> statement-breakpoint

-- ============================================
-- 11. Re-add FK constraints with new names
-- ============================================

ALTER TABLE "configurations" ADD CONSTRAINT "configurations_organization_id_fkey"
	FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_active_snapshot_id_fkey"
	FOREIGN KEY ("active_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null;
--> statement-breakpoint

ALTER TABLE "configuration_repos" ADD CONSTRAINT "configuration_repos_pkey"
	PRIMARY KEY ("configuration_id", "repo_id");
--> statement-breakpoint
ALTER TABLE "configuration_repos" ADD CONSTRAINT "configuration_repos_configuration_id_fkey"
	FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "configuration_repos" ADD CONSTRAINT "configuration_repos_repo_id_fkey"
	FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_configuration_id_fkey"
	FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_configuration_id_fkey"
	FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_configuration_id_fkey"
	FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE set null;
--> statement-breakpoint

-- ============================================
-- 12. Rename indexes
-- ============================================

ALTER INDEX IF EXISTS "idx_prebuilds_org" RENAME TO "idx_configurations_org";
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_snapshots_prebuild" RENAME TO "idx_snapshots_configuration";
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_secret_files_prebuild" RENAME TO "idx_secret_files_configuration";
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_prebuild_repos_prebuild" RENAME TO "idx_configuration_repos_configuration";
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_prebuild_repos_repo" RENAME TO "idx_configuration_repos_repo";
--> statement-breakpoint

-- Rename secret_files unique constraint
ALTER TABLE "secret_files" DROP CONSTRAINT IF EXISTS "secret_files_prebuild_workspace_file_unique";
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_configuration_workspace_file_unique"
	UNIQUE ("configuration_id", "workspace_path", "file_path");
--> statement-breakpoint

-- ============================================
-- 13. Add CHECK constraints
-- ============================================

ALTER TABLE "configurations" ADD CONSTRAINT "configurations_sandbox_provider_check"
	CHECK (sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text]));
--> statement-breakpoint

-- snapshots already has sandbox_provider check from expand migration
-- Add if missing
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'snapshots_sandbox_provider_check'
	) THEN
		ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_sandbox_provider_check"
			CHECK (sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text]));
	END IF;
END $$;
--> statement-breakpoint

-- Note: No unique constraint on (organization_id, name) — the creation
-- flow uses "Untitled" as default and doesn't generate unique names.
