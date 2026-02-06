CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$ BEGIN RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"userId" text NOT NULL,
	"refillInterval" integer,
	"refillAmount" integer,
	"lastRefillAt" timestamp with time zone,
	"enabled" boolean,
	"rateLimitEnabled" boolean,
	"rateLimitTimeWindow" integer,
	"rateLimitMax" integer,
	"requestCount" integer,
	"remaining" integer,
	"lastRequest" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text DEFAULT 'Untitled Automation' NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true,
	"agent_instructions" text,
	"agent_type" text DEFAULT 'opencode',
	"model_id" text DEFAULT 'claude-sonnet-4-20250514',
	"allow_agentic_repo_selection" boolean DEFAULT false,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"default_prebuild_id" uuid
);
--> statement-breakpoint
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"event_type" text NOT NULL,
	"quantity" numeric(12, 6) NOT NULL,
	"credits" numeric(12, 6) NOT NULL,
	"idempotency_key" text NOT NULL,
	"session_ids" text[] DEFAULT '{""}',
	"status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0,
	"next_retry_at" timestamp with time zone DEFAULT now(),
	"last_error" text,
	"autumn_response" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_events_idempotency_key_key" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "cli_device_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_code" text NOT NULL,
	"device_code" text NOT NULL,
	"user_id" text,
	"org_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"authorized_at" timestamp with time zone,
	CONSTRAINT "cli_device_codes_user_code_key" UNIQUE("user_code"),
	CONSTRAINT "cli_device_codes_device_code_key" UNIQUE("device_code")
);
--> statement-breakpoint
CREATE TABLE "cli_github_selections" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cli_github_selections_pkey" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"integration_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"display_name" text,
	"scopes" text[],
	"status" text DEFAULT 'active',
	"visibility" text DEFAULT 'org',
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"github_installation_id" text,
	CONSTRAINT "integrations_connection_id_key" UNIQUE("connection_id"),
	CONSTRAINT "integrations_visibility_check" CHECK (visibility = ANY (ARRAY['org'::text, 'private'::text]))
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"inviterId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"createdAt" timestamp with time zone NOT NULL,
	"metadata" text,
	"allowed_domains" text[],
	"is_personal" boolean DEFAULT false,
	"autumn_customer_id" text,
	"billing_settings" jsonb DEFAULT '{"overage_policy":"pause","overage_cap_cents":null,"overage_used_this_month_cents":0}'::jsonb,
	"onboarding_complete" boolean DEFAULT false,
	CONSTRAINT "organization_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prebuild_repos" (
	"prebuild_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"workspace_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "prebuild_repos_pkey" PRIMARY KEY("prebuild_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "prebuilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" text,
	"status" text DEFAULT 'building',
	"error" text,
	"created_by" text,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"sandbox_provider" text DEFAULT 'modal' NOT NULL,
	"user_id" text,
	"local_path_hash" text,
	"type" text DEFAULT 'manual',
	CONSTRAINT "prebuilds_user_path_unique" UNIQUE("user_id","local_path_hash"),
	CONSTRAINT "prebuilds_sandbox_provider_check" CHECK (sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text])),
	CONSTRAINT "prebuilds_cli_requires_path" CHECK (((user_id IS NOT NULL) AND (local_path_hash IS NOT NULL)) OR ((user_id IS NULL) AND (local_path_hash IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "repo_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "repo_connections_repo_id_integration_id_key" UNIQUE("repo_id","integration_id")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"github_url" text NOT NULL,
	"github_repo_id" text NOT NULL,
	"github_repo_name" text NOT NULL,
	"default_branch" text DEFAULT 'main',
	"setup_commands" text[],
	"detected_stack" jsonb,
	"is_orphaned" boolean DEFAULT false,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"source" text DEFAULT 'github',
	"is_private" boolean DEFAULT false,
	"local_path_hash" text,
	CONSTRAINT "repos_organization_id_github_repo_id_key" UNIQUE("organization_id","github_repo_id"),
	CONSTRAINT "repos_source_check" CHECK (((source = 'local'::text) AND (local_path_hash IS NOT NULL)) OR (source <> 'local'::text))
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"cron_expression" text NOT NULL,
	"timezone" text DEFAULT 'UTC',
	"enabled" boolean DEFAULT true,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"repo_id" uuid,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"secret_type" text DEFAULT 'env',
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"prebuild_id" uuid,
	CONSTRAINT "secrets_org_repo_prebuild_key_unique" UNIQUE("organization_id","repo_id","key","prebuild_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"activeOrganizationId" text,
	CONSTRAINT "session_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid,
	"organization_id" text NOT NULL,
	"created_by" text,
	"session_type" text DEFAULT 'coding',
	"status" text DEFAULT 'starting',
	"sandbox_id" text,
	"snapshot_id" text,
	"branch_name" text,
	"base_commit_sha" text,
	"parent_session_id" uuid,
	"initial_prompt" text,
	"title" text,
	"automation_id" uuid,
	"trigger_id" uuid,
	"trigger_event_id" uuid,
	"started_at" timestamp with time zone DEFAULT now(),
	"last_activity_at" timestamp with time zone DEFAULT now(),
	"paused_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"idle_timeout_minutes" integer DEFAULT 30,
	"auto_delete_days" integer DEFAULT 7,
	"source" text DEFAULT 'web',
	"sandbox_provider" text DEFAULT 'modal' NOT NULL,
	"origin" text DEFAULT 'web',
	"local_path_hash" text,
	"sandbox_url" text,
	"coding_agent_session_id" text,
	"open_code_tunnel_url" text,
	"preview_tunnel_url" text,
	"agent_config" jsonb,
	"system_prompt" text,
	"client_type" text,
	"client_metadata" jsonb,
	"prebuild_id" uuid,
	"sandbox_expires_at" timestamp with time zone,
	"metered_through_at" timestamp with time zone,
	"billing_token_version" integer DEFAULT 1,
	"last_seen_alive_at" timestamp with time zone,
	"alive_check_failures" integer DEFAULT 0,
	"pause_reason" text,
	"stop_reason" text,
	CONSTRAINT "sessions_sandbox_provider_check" CHECK (sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text]))
);
--> statement-breakpoint
CREATE TABLE "slack_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_installation_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"session_id" uuid,
	"repo_id" uuid,
	"started_by_slack_user_id" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"last_message_at" timestamp with time zone DEFAULT now(),
	"pending_prompt" text,
	CONSTRAINT "slack_conversations_slack_installation_id_channel_id_thread_key" UNIQUE("slack_installation_id","channel_id","thread_ts")
);
--> statement-breakpoint
CREATE TABLE "slack_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"encrypted_bot_token" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"scopes" text[],
	"installed_by" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"support_channel_id" text,
	"support_channel_name" text,
	"support_invite_id" text,
	"support_invite_url" text,
	CONSTRAINT "slack_installations_organization_id_team_id_key" UNIQUE("organization_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "trigger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"external_event_id" text,
	"provider_event_type" text,
	"status" text DEFAULT 'queued',
	"session_id" uuid,
	"raw_payload" jsonb NOT NULL,
	"parsed_context" jsonb,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"skip_reason" text,
	"dedup_key" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"automation_id" uuid NOT NULL,
	"name" text,
	"description" text,
	"trigger_type" text DEFAULT 'webhook' NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"execution_mode" text DEFAULT 'auto',
	"allow_agentic_repo_selection" boolean DEFAULT false,
	"agent_instructions" text,
	"webhook_secret" text,
	"webhook_url_path" text,
	"polling_cron" text,
	"polling_endpoint" text,
	"polling_state" jsonb DEFAULT '{}'::jsonb,
	"last_polled_at" timestamp with time zone,
	"config" jsonb DEFAULT '{}'::jsonb,
	"integration_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"repeat_job_key" text,
	CONSTRAINT "triggers_webhook_url_path_key" UNIQUE("webhook_url_path")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_ssh_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_ssh_keys_fingerprint_key" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_default_prebuild_id_fkey" FOREIGN KEY ("default_prebuild_id") REFERENCES "public"."prebuilds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_codes" ADD CONSTRAINT "cli_device_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_codes" ADD CONSTRAINT "cli_device_codes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_github_selections" ADD CONSTRAINT "cli_github_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_github_selections" ADD CONSTRAINT "cli_github_selections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prebuild_repos" ADD CONSTRAINT "prebuild_repos_prebuild_id_fkey" FOREIGN KEY ("prebuild_id") REFERENCES "public"."prebuilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prebuild_repos" ADD CONSTRAINT "prebuild_repos_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD CONSTRAINT "prebuilds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD CONSTRAINT "prebuilds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_connections" ADD CONSTRAINT "repo_connections_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_connections" ADD CONSTRAINT "repo_connections_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_prebuild_id_fkey" FOREIGN KEY ("prebuild_id") REFERENCES "public"."prebuilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_trigger_event" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."trigger_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_prebuild_id_fkey" FOREIGN KEY ("prebuild_id") REFERENCES "public"."prebuilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversations" ADD CONSTRAINT "slack_conversations_slack_installation_id_fkey" FOREIGN KEY ("slack_installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversations" ADD CONSTRAINT "slack_conversations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversations" ADD CONSTRAINT "slack_conversations_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_installed_by_fkey" FOREIGN KEY ("installed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD CONSTRAINT "trigger_events_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD CONSTRAINT "trigger_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD CONSTRAINT "trigger_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ssh_keys" ADD CONSTRAINT "user_ssh_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "idx_automations_enabled" ON "automations" USING btree ("enabled" bool_ops) WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "idx_automations_org" ON "automations" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_automations_prebuild" ON "automations" USING btree ("default_prebuild_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_org" ON "billing_events" USING btree ("organization_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_outbox" ON "billing_events" USING btree ("status" text_ops,"next_retry_at" timestamptz_ops) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));--> statement-breakpoint
CREATE INDEX "idx_billing_events_session" ON "billing_events" USING gin ("session_ids" array_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_type" ON "billing_events" USING btree ("organization_id" text_ops,"event_type" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_cli_device_codes_device_code" ON "cli_device_codes" USING btree ("device_code" text_ops);--> statement-breakpoint
CREATE INDEX "idx_cli_device_codes_expires" ON "cli_device_codes" USING btree ("expires_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_cli_device_codes_user_code" ON "cli_device_codes" USING btree ("user_code" text_ops);--> statement-breakpoint
CREATE INDEX "idx_cli_github_selections_expires_at" ON "cli_github_selections" USING btree ("expires_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_integrations_github_installation" ON "integrations" USING btree ("github_installation_id" text_ops) WHERE (github_installation_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_integrations_org" ON "integrations" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organizationId" text_ops);--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organizationId" text_ops);--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "organization_allowed_domains_idx" ON "organization" USING gin ("allowed_domains" array_ops);--> statement-breakpoint
CREATE INDEX "organization_autumn_customer_idx" ON "organization" USING btree ("autumn_customer_id" text_ops) WHERE (autumn_customer_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug" text_ops);--> statement-breakpoint
CREATE INDEX "idx_prebuild_repos_prebuild" ON "prebuild_repos" USING btree ("prebuild_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_prebuild_repos_repo" ON "prebuild_repos" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_prebuilds_sandbox_provider" ON "prebuilds" USING btree ("sandbox_provider" text_ops);--> statement-breakpoint
CREATE INDEX "idx_prebuilds_type_managed" ON "prebuilds" USING btree ("type" text_ops) WHERE (type = 'managed'::text);--> statement-breakpoint
CREATE INDEX "idx_repo_connections_integration" ON "repo_connections" USING btree ("integration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_repo_connections_repo" ON "repo_connections" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_repos_local_path_hash" ON "repos" USING btree ("local_path_hash" text_ops) WHERE (local_path_hash IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_repos_org" ON "repos" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_schedules_automation" ON "schedules" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_schedules_next_run" ON "schedules" USING btree ("next_run_at" timestamptz_ops) WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "idx_schedules_org" ON "schedules" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_secrets_org" ON "secrets" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_secrets_repo" ON "secrets" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_automation" ON "sessions" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_client_type" ON "sessions" USING btree ("client_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_local_path_hash" ON "sessions" USING btree ("local_path_hash" text_ops) WHERE (local_path_hash IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_sessions_org" ON "sessions" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_parent" ON "sessions" USING btree ("parent_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_prebuild" ON "sessions" USING btree ("prebuild_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_repo" ON "sessions" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_sandbox_expires_at" ON "sessions" USING btree ("sandbox_expires_at" timestamptz_ops) WHERE (sandbox_expires_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_sessions_sandbox_provider" ON "sessions" USING btree ("sandbox_provider" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_slack_lookup" ON "sessions" USING btree (((client_metadata ->> 'installationId'::text)),((client_metadata ->> 'channelId'::text)),((client_metadata ->> 'threadTs'::text))) WHERE (client_type = 'slack'::text);--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_trigger" ON "sessions" USING btree ("trigger_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_slack_conversations_installation" ON "slack_conversations" USING btree ("slack_installation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_slack_conversations_session" ON "slack_conversations" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_slack_conversations_thread" ON "slack_conversations" USING btree ("channel_id" text_ops,"thread_ts" text_ops);--> statement-breakpoint
CREATE INDEX "idx_slack_installations_org" ON "slack_installations" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_slack_installations_team" ON "slack_installations" USING btree ("team_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trigger_events_dedup" ON "trigger_events" USING btree ("trigger_id" uuid_ops,"dedup_key" text_ops) WHERE (dedup_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_trigger_events_org_status" ON "trigger_events" USING btree ("organization_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_trigger_events_queued" ON "trigger_events" USING btree ("status" text_ops,"created_at" timestamptz_ops) WHERE (status = 'queued'::text);--> statement-breakpoint
CREATE INDEX "idx_trigger_events_skipped" ON "trigger_events" USING btree ("trigger_id" uuid_ops,"status" text_ops) WHERE (status = 'skipped'::text);--> statement-breakpoint
CREATE INDEX "idx_trigger_events_status" ON "trigger_events" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_trigger_events_trigger" ON "trigger_events" USING btree ("trigger_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_triggers_automation" ON "triggers" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_triggers_enabled_polling" ON "triggers" USING btree ("enabled" bool_ops,"trigger_type" text_ops) WHERE ((trigger_type = 'polling'::text) AND (enabled = true));--> statement-breakpoint
CREATE INDEX "idx_triggers_enabled_scheduled" ON "triggers" USING btree ("enabled" bool_ops,"provider" text_ops) WHERE ((provider = 'scheduled'::text) AND (enabled = true));--> statement-breakpoint
CREATE INDEX "idx_triggers_org" ON "triggers" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_triggers_repeat_job_key" ON "triggers" USING btree ("repeat_job_key" text_ops) WHERE (repeat_job_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_triggers_webhook_path" ON "triggers" USING btree ("webhook_url_path" text_ops);--> statement-breakpoint
CREATE INDEX "idx_user_ssh_keys_user" ON "user_ssh_keys" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier" text_ops);--> statement-breakpoint
CREATE POLICY "Users can delete automations in their org" ON "automations" AS PERMISSIVE FOR DELETE TO public USING ((organization_id IN ( SELECT member."organizationId"
   FROM member
  WHERE (member."userId" = auth.uid()))));--> statement-breakpoint
CREATE POLICY "Users can update automations in their org" ON "automations" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Users can insert automations in their org" ON "automations" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Users can view automations in their org" ON "automations" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Users can delete schedules in their org" ON "schedules" AS PERMISSIVE FOR DELETE TO public USING ((organization_id IN ( SELECT member."organizationId"
   FROM member
  WHERE (member."userId" = auth.uid()))));--> statement-breakpoint
CREATE POLICY "Users can update schedules in their org" ON "schedules" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Users can insert schedules in their org" ON "schedules" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Users can view schedules in their org" ON "schedules" AS PERMISSIVE FOR SELECT TO public;
