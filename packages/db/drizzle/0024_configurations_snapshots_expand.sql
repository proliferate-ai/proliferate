-- PR1 Expand: Add snapshots, secret_files, configuration_secrets tables.
-- Add organization_id + active_snapshot_id to prebuilds.
-- Backfill data from existing prebuilds/repos/secrets.

-- ============================================
-- 1. Create new tables
-- ============================================

CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prebuild_id" uuid NOT NULL,
	"provider_snapshot_id" text,
	"sandbox_provider" text,
	"status" text DEFAULT 'building' NOT NULL,
	"has_deps" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "snapshots_status_check" CHECK (status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text]))
);
--> statement-breakpoint

CREATE TABLE "snapshot_repos" (
	"snapshot_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "snapshot_repos_pkey" PRIMARY KEY("snapshot_id","repo_id")
);
--> statement-breakpoint

CREATE TABLE "secret_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prebuild_id" uuid NOT NULL,
	"workspace_path" text DEFAULT '.' NOT NULL,
	"file_path" text NOT NULL,
	"mode" text DEFAULT 'secret' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "secret_files_prebuild_workspace_file_unique" UNIQUE("prebuild_id","workspace_path","file_path")
);
--> statement-breakpoint

CREATE TABLE "configuration_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_file_id" uuid NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text,
	"required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "configuration_secrets_file_key_unique" UNIQUE("secret_file_id","key")
);
--> statement-breakpoint

-- ============================================
-- 2. Add new columns to prebuilds (nullable initially)
-- ============================================

ALTER TABLE "prebuilds" ADD COLUMN "organization_id" text;
--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "active_snapshot_id" uuid;
--> statement-breakpoint

-- ============================================
-- 3. Backfill prebuilds.organization_id from prebuild_repos → repos
-- ============================================

UPDATE "prebuilds" p
SET "organization_id" = (
	SELECT r."organization_id"
	FROM "prebuild_repos" pr
	JOIN "repos" r ON r."id" = pr."repo_id"
	WHERE pr."prebuild_id" = p."id"
	LIMIT 1
)
WHERE "organization_id" IS NULL;
--> statement-breakpoint

-- Delete orphaned prebuilds that have no repos (can't determine org)
DELETE FROM "prebuilds"
WHERE "organization_id" IS NULL;
--> statement-breakpoint

-- Now set NOT NULL
ALTER TABLE "prebuilds" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint

-- ============================================
-- 4. Migrate existing snapshot data to snapshots table
--    For each prebuild with snapshot_id IS NOT NULL,
--    create a snapshots row (status=ready, has_deps=true)
--    then set active_snapshot_id
-- ============================================

INSERT INTO "snapshots" ("id", "prebuild_id", "provider_snapshot_id", "sandbox_provider", "status", "has_deps", "created_at", "updated_at")
SELECT
	gen_random_uuid(),
	p."id",
	p."snapshot_id",
	p."sandbox_provider",
	'ready',
	true,
	COALESCE(p."created_at", now()),
	now()
FROM "prebuilds" p
WHERE p."snapshot_id" IS NOT NULL;
--> statement-breakpoint

UPDATE "prebuilds" p
SET "active_snapshot_id" = s."id"
FROM "snapshots" s
WHERE s."prebuild_id" = p."id"
  AND s."provider_snapshot_id" = p."snapshot_id"
  AND p."snapshot_id" IS NOT NULL;
--> statement-breakpoint

-- ============================================
-- 5. Migrate env_files JSONB → secret_files + configuration_secrets
--    The env_files column stores an array of objects like:
--    [{workspacePath, path, format, mode, keys: [{key, required}]}]
--    For each file entry, create a secret_files row.
--    For each key in the file, create a configuration_secrets row (no encrypted value).
-- ============================================

-- Create secret_files from env_files JSONB
INSERT INTO "secret_files" ("id", "prebuild_id", "workspace_path", "file_path", "mode", "created_at", "updated_at")
SELECT
	gen_random_uuid(),
	p."id",
	COALESCE(ef->>'workspacePath', '.'),
	ef->>'path',
	COALESCE(ef->>'mode', 'secret'),
	now(),
	now()
FROM "prebuilds" p,
	jsonb_array_elements(p."env_files") AS ef
WHERE p."env_files" IS NOT NULL
  AND jsonb_typeof(p."env_files") = 'array'
  AND ef->>'path' IS NOT NULL
ON CONFLICT ("prebuild_id", "workspace_path", "file_path") DO NOTHING;
--> statement-breakpoint

-- Create configuration_secrets from env_files keys
INSERT INTO "configuration_secrets" ("id", "secret_file_id", "key", "required", "created_at", "updated_at")
SELECT
	gen_random_uuid(),
	sf."id",
	k->>'key',
	COALESCE((k->>'required')::boolean, false),
	now(),
	now()
FROM "prebuilds" p
CROSS JOIN LATERAL jsonb_array_elements(p."env_files") AS ef
CROSS JOIN LATERAL jsonb_array_elements(ef->'keys') AS k
JOIN "secret_files" sf
	ON sf."prebuild_id" = p."id"
	AND sf."workspace_path" = COALESCE(ef->>'workspacePath', '.')
	AND sf."file_path" = ef->>'path'
WHERE p."env_files" IS NOT NULL
  AND jsonb_typeof(p."env_files") = 'array'
  AND ef->>'path' IS NOT NULL
  AND k->>'key' IS NOT NULL
ON CONFLICT ("secret_file_id", "key") DO NOTHING;
--> statement-breakpoint

-- ============================================
-- 6. Migrate bundle secrets to configuration-scoped secret_files
--    For bundles with target_path, create secret_files + configuration_secrets
--    rows for each configuration in the bundle's org.
-- ============================================

-- Create secret_files for bundle target_paths on each prebuild in the org
INSERT INTO "secret_files" ("id", "prebuild_id", "workspace_path", "file_path", "mode", "created_at", "updated_at")
SELECT DISTINCT
	gen_random_uuid(),
	p."id",
	'.',
	sb."target_path",
	'secret',
	now(),
	now()
FROM "secret_bundles" sb
JOIN "prebuilds" p ON p."organization_id" = sb."organization_id"
WHERE sb."target_path" IS NOT NULL
ON CONFLICT ("prebuild_id", "workspace_path", "file_path") DO NOTHING;
--> statement-breakpoint

-- Create configuration_secrets with encrypted values from bundle secrets
INSERT INTO "configuration_secrets" ("id", "secret_file_id", "key", "encrypted_value", "required", "created_at", "updated_at")
SELECT
	gen_random_uuid(),
	sf."id",
	s."key",
	s."encrypted_value",
	false,
	now(),
	now()
FROM "secrets" s
JOIN "secret_bundles" sb ON sb."id" = s."bundle_id"
JOIN "prebuilds" p ON p."organization_id" = sb."organization_id"
JOIN "secret_files" sf
	ON sf."prebuild_id" = p."id"
	AND sf."file_path" = sb."target_path"
	AND sf."workspace_path" = '.'
WHERE sb."target_path" IS NOT NULL
  AND s."bundle_id" IS NOT NULL
ON CONFLICT ("secret_file_id", "key") DO NOTHING;
--> statement-breakpoint

-- ============================================
-- 7. Foreign keys for new tables
-- ============================================

ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_prebuild_id_fkey" FOREIGN KEY ("prebuild_id") REFERENCES "public"."prebuilds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_repos" ADD CONSTRAINT "snapshot_repos_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "snapshot_repos" ADD CONSTRAINT "snapshot_repos_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_prebuild_id_fkey" FOREIGN KEY ("prebuild_id") REFERENCES "public"."prebuilds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "configuration_secrets" ADD CONSTRAINT "configuration_secrets_secret_file_id_fkey" FOREIGN KEY ("secret_file_id") REFERENCES "public"."secret_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Prebuilds new column FKs
ALTER TABLE "prebuilds" ADD CONSTRAINT "prebuilds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prebuilds" ADD CONSTRAINT "prebuilds_active_snapshot_id_snapshots_id_fk" FOREIGN KEY ("active_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- ============================================
-- 8. Indexes
-- ============================================

CREATE INDEX "idx_snapshots_prebuild" ON "snapshots" USING btree ("prebuild_id" uuid_ops);
--> statement-breakpoint
CREATE INDEX "idx_secret_files_prebuild" ON "secret_files" USING btree ("prebuild_id" uuid_ops);
--> statement-breakpoint
CREATE INDEX "idx_configuration_secrets_file" ON "configuration_secrets" USING btree ("secret_file_id" uuid_ops);
--> statement-breakpoint
CREATE INDEX "idx_prebuilds_org" ON "prebuilds" USING btree ("organization_id" text_ops);
