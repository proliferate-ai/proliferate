-- Phase 0: vNext database additions
-- New tables and columns for webhook inbox, poll groups, tool invocations,
-- user connections, secret files, and configuration secrets.

-- New columns on existing tables
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "action_modes" jsonb;
--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "action_modes" jsonb;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "org_connectors" ADD COLUMN IF NOT EXISTS "tool_risk_overrides" jsonb;
--> statement-breakpoint

-- webhook_inbox: raw webhook events before processing
CREATE TABLE IF NOT EXISTS "webhook_inbox" (
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
CREATE INDEX IF NOT EXISTS "idx_webhook_inbox_status" ON "webhook_inbox" USING btree ("status" text_ops, "received_at" timestamptz_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_inbox_provider" ON "webhook_inbox" USING btree ("provider" text_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_inbox_org" ON "webhook_inbox" USING btree ("organization_id" text_ops);
--> statement-breakpoint

-- trigger_poll_groups: groups polling triggers for batch polling
CREATE TABLE IF NOT EXISTS "trigger_poll_groups" (
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
CREATE INDEX IF NOT EXISTS "idx_trigger_poll_groups_org" ON "trigger_poll_groups" USING btree ("organization_id" text_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trigger_poll_groups_enabled" ON "trigger_poll_groups" USING btree ("enabled" bool_ops);
--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- session_tool_invocations: tool call audit trail within sessions
CREATE TABLE IF NOT EXISTS "session_tool_invocations" (
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
CREATE INDEX IF NOT EXISTS "idx_session_tool_invocations_session" ON "session_tool_invocations" USING btree ("session_id" uuid_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_tool_invocations_org" ON "session_tool_invocations" USING btree ("organization_id" text_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_tool_invocations_status" ON "session_tool_invocations" USING btree ("status" text_ops);
--> statement-breakpoint
ALTER TABLE "session_tool_invocations" ADD CONSTRAINT "session_tool_invocations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_tool_invocations" ADD CONSTRAINT "session_tool_invocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- user_connections: user-level integration connections
CREATE TABLE IF NOT EXISTS "user_connections" (
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
CREATE INDEX IF NOT EXISTS "idx_user_connections_user" ON "user_connections" USING btree ("user_id" text_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_connections_org" ON "user_connections" USING btree ("organization_id" text_ops);
--> statement-breakpoint
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- secret_files: file-based secrets written to sandbox (replaces secret_bundles approach)
CREATE TABLE IF NOT EXISTS "secret_files" (
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
CREATE INDEX IF NOT EXISTS "idx_secret_files_org" ON "secret_files" USING btree ("organization_id" text_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_secret_files_configuration" ON "secret_files" USING btree ("configuration_id" uuid_ops);
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."prebuilds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- configuration_secrets: links configurations to secrets for scoped secret injection
CREATE TABLE IF NOT EXISTS "configuration_secrets" (
	"configuration_id" uuid NOT NULL,
	"secret_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "configuration_secrets_pkey" PRIMARY KEY("configuration_id","secret_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_configuration_secrets_configuration" ON "configuration_secrets" USING btree ("configuration_id" uuid_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_configuration_secrets_secret" ON "configuration_secrets" USING btree ("secret_id" uuid_ops);
--> statement-breakpoint
ALTER TABLE "configuration_secrets" ADD CONSTRAINT "configuration_secrets_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."prebuilds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "configuration_secrets" ADD CONSTRAINT "configuration_secrets_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;
