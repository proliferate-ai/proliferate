-- vNext Phase 0: Schema renames, table drops, and new tables
--
-- Renames:
--   prebuilds        → configurations
--   prebuild_repos   → configuration_repos
--   prebuild_id col  → configuration_id (in configuration_repos)
--
-- Drops:
--   secret_bundles   (replaced by secret_files + configuration_secrets)
--   action_grants    (replaced by action_modes jsonb on org/automation)
--   bundle_id column on secrets (+ index + FK)
--
-- New tables:
--   configuration_secrets, secret_files, session_tool_invocations,
--   trigger_poll_groups, user_connections, webhook_inbox
--
-- New columns:
--   automations.action_modes, organization.action_modes,
--   sessions.idempotency_key, org_connectors.tool_risk_overrides

-- ========== RENAMES ==========

ALTER TABLE "prebuilds" RENAME TO "configurations";
--> statement-breakpoint
ALTER TABLE "prebuild_repos" RENAME TO "configuration_repos";
--> statement-breakpoint
ALTER TABLE "configuration_repos" RENAME COLUMN "prebuild_id" TO "configuration_id";
--> statement-breakpoint

-- ========== DROPS ==========

-- Drop secret_bundles (cascade removes FKs referencing it)
ALTER TABLE "secret_bundles" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TABLE "secret_bundles" CASCADE;
--> statement-breakpoint

-- Drop action_grants
ALTER TABLE "action_grants" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TABLE "action_grants" CASCADE;
--> statement-breakpoint

-- Remove bundle_id from secrets
ALTER TABLE "secrets" DROP CONSTRAINT IF EXISTS "secrets_bundle_id_fkey";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_secrets_bundle";
--> statement-breakpoint
ALTER TABLE "secrets" DROP COLUMN IF EXISTS "bundle_id";
--> statement-breakpoint

-- ========== NEW TABLES ==========

CREATE TABLE "configuration_secrets" (
	"configuration_id" uuid NOT NULL,
	"secret_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "configuration_secrets_pkey" PRIMARY KEY("configuration_id","secret_id")
);
--> statement-breakpoint
CREATE TABLE "secret_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"configuration_id" uuid,
	"file_path" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "secret_files_org_config_path_unique" UNIQUE("organization_id","configuration_id","file_path")
);
--> statement-breakpoint
CREATE TABLE "session_tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_source" text,
	"status" text DEFAULT 'pending',
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trigger_poll_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"integration_id" uuid,
	"cron_expression" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"last_polled_at" timestamp with time zone,
	"cursor" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"connection_id" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'active',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_connections_user_org_provider_connection_key" UNIQUE("user_id","organization_id","provider","connection_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"provider" text NOT NULL,
	"external_id" text,
	"headers" jsonb,
	"payload" jsonb NOT NULL,
	"signature" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"processed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

-- ========== NEW COLUMNS ==========

ALTER TABLE "automations" ADD COLUMN "action_modes" jsonb;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "action_modes" jsonb;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "org_connectors" ADD COLUMN "tool_risk_overrides" jsonb;
--> statement-breakpoint

-- ========== FOREIGN KEYS ==========

ALTER TABLE "configuration_secrets" ADD CONSTRAINT "configuration_secrets_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "configuration_secrets" ADD CONSTRAINT "configuration_secrets_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_tool_invocations" ADD CONSTRAINT "session_tool_invocations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_tool_invocations" ADD CONSTRAINT "session_tool_invocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- ========== INDEXES ==========

CREATE INDEX "idx_configuration_secrets_configuration" ON "configuration_secrets" USING btree ("configuration_id");
--> statement-breakpoint
CREATE INDEX "idx_configuration_secrets_secret" ON "configuration_secrets" USING btree ("secret_id");
--> statement-breakpoint
CREATE INDEX "idx_secret_files_org" ON "secret_files" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_secret_files_configuration" ON "secret_files" USING btree ("configuration_id");
--> statement-breakpoint
CREATE INDEX "idx_session_tool_invocations_session" ON "session_tool_invocations" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "idx_session_tool_invocations_org" ON "session_tool_invocations" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_session_tool_invocations_status" ON "session_tool_invocations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_trigger_poll_groups_org" ON "trigger_poll_groups" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_trigger_poll_groups_enabled" ON "trigger_poll_groups" USING btree ("enabled");
--> statement-breakpoint
CREATE INDEX "idx_user_connections_user" ON "user_connections" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_user_connections_org" ON "user_connections" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_status" ON "webhook_inbox" USING btree ("status","received_at");
--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_provider" ON "webhook_inbox" USING btree ("provider");
--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_org" ON "webhook_inbox" USING btree ("organization_id");
