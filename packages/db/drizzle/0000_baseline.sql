CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$ BEGIN RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE TABLE "action_invocation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_invocation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" uuid,
	"integration" text NOT NULL,
	"action" text NOT NULL,
	"risk_level" text NOT NULL,
	"mode" text,
	"mode_source" text,
	"params" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"denied_reason" text,
	"duration_ms" integer,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "action_invocations_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'expired'::text, 'executing'::text, 'completed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "resume_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_session_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload_json" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "resume_intents_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'claimed'::text, 'resuming'::text, 'satisfied'::text, 'continued'::text, 'resume_failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "user_action_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" text NOT NULL,
	"action_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_action_prefs_user_org_source_action_key" UNIQUE NULLS NOT DISTINCT("user_id","organization_id","source_id","action_id")
);
--> statement-breakpoint
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
	"billing_settings" jsonb DEFAULT '{"overage_policy":"pause","overage_cap_cents":null}'::jsonb,
	"onboarding_complete" boolean DEFAULT false,
	"billing_state" text DEFAULT 'free' NOT NULL,
	"billing_plan" text,
	"shadow_balance" numeric(12, 6) DEFAULT '0',
	"shadow_balance_updated_at" timestamp with time zone,
	"grace_entered_at" timestamp with time zone,
	"grace_expires_at" timestamp with time zone,
	"onboarding_meta" jsonb,
	"action_modes" jsonb,
	"overage_used_cents" integer DEFAULT 0 NOT NULL,
	"overage_cycle_month" text,
	"overage_topup_count" integer DEFAULT 0 NOT NULL,
	"overage_last_topup_at" timestamp with time zone,
	"overage_decline_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	CONSTRAINT "organization_slug_key" UNIQUE("slug")
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
CREATE TABLE "automation_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "automation_connections_automation_id_integration_id_key" UNIQUE("automation_id","integration_id")
);
--> statement-breakpoint
CREATE TABLE "automation_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"automation_id" uuid NOT NULL,
	"trigger_event_id" uuid NOT NULL,
	"trigger_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"failure_stage" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enrichment_started_at" timestamp with time zone,
	"enrichment_completed_at" timestamp with time zone,
	"execution_started_at" timestamp with time zone,
	"prompt_sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"session_id" uuid,
	"session_created_at" timestamp with time zone,
	"completion_id" text,
	"completion_json" jsonb,
	"completion_artifact_ref" text,
	"enrichment_json" jsonb,
	"enrichment_artifact_ref" text,
	"sources_artifact_ref" text,
	"policy_artifact_ref" text,
	"error_code" text,
	"error_message" text,
	"assigned_to" text,
	"assigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_side_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"effect_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text,
	"request_hash" text,
	"response_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "automation_side_effects_org_effect_key" UNIQUE("organization_id","effect_id")
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
	"default_configuration_id" uuid,
	"llm_filter_prompt" text,
	"enabled_tools" jsonb DEFAULT '{}'::jsonb,
	"llm_analysis_prompt" text,
	"config_selection_strategy" text DEFAULT 'fixed',
	"fallback_configuration_id" uuid,
	"allowed_configuration_ids" jsonb,
	"notification_destination_type" text DEFAULT 'none',
	"notification_channel_id" text,
	"notification_slack_user_id" text,
	"notification_slack_installation_id" uuid,
	"action_modes" jsonb,
	"worker_id" uuid,
	"source_template_id" text,
	CONSTRAINT "chk_automations_dm_user_slack_id" CHECK ((notification_destination_type != 'slack_dm_user') OR (notification_slack_user_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now(),
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_event_keys" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "billing_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"previous_balance" numeric(12, 6) NOT NULL,
	"new_balance" numeric(12, 6) NOT NULL,
	"delta" numeric(12, 6) NOT NULL,
	"reason" text NOT NULL,
	"performed_by" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_spend_cursors" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"last_start_time" timestamp with time zone NOT NULL,
	"last_request_id" text,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configuration_repos" (
	"configuration_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"workspace_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "configuration_repos_pkey" PRIMARY KEY("configuration_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" text,
	"status" text DEFAULT 'building',
	"error" text,
	"created_by" text,
	"name" text NOT NULL,
	"notes" text,
	"routing_description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"sandbox_provider" text DEFAULT 'e2b' NOT NULL,
	"user_id" text,
	"local_path_hash" text,
	"type" text DEFAULT 'manual',
	"service_commands" jsonb,
	"service_commands_updated_at" timestamp with time zone,
	"service_commands_updated_by" text,
	"env_files" jsonb,
	"env_files_updated_at" timestamp with time zone,
	"env_files_updated_by" text,
	"connectors" jsonb,
	"connectors_updated_at" timestamp with time zone,
	"connectors_updated_by" text,
	"refresh_enabled" boolean DEFAULT false NOT NULL,
	"refresh_interval_minutes" integer DEFAULT 360 NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	CONSTRAINT "configurations_user_path_unique" UNIQUE("user_id","local_path_hash"),
	CONSTRAINT "configurations_sandbox_provider_check" CHECK (sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text])),
	CONSTRAINT "configurations_cli_requires_path" CHECK (((user_id IS NOT NULL) AND (local_path_hash IS NOT NULL)) OR ((user_id IS NULL) AND (local_path_hash IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "sandbox_base_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_key" text NOT NULL,
	"snapshot_id" text,
	"status" text DEFAULT 'building' NOT NULL,
	"error" text,
	"provider" text DEFAULT 'e2b' NOT NULL,
	"modal_app_name" text NOT NULL,
	"built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sandbox_base_snapshots_status_check" CHECK (status = ANY (ARRAY['building'::text, 'ready'::text, 'failed'::text]))
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
	"encrypted_access_token" text,
	"encrypted_refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"token_type" text,
	"connection_metadata" jsonb,
	CONSTRAINT "integrations_connection_id_key" UNIQUE("connection_id"),
	CONSTRAINT "integrations_visibility_check" CHECK (visibility = ANY (ARRAY['org'::text, 'private'::text]))
);
--> statement-breakpoint
CREATE TABLE "org_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"transport" text DEFAULT 'remote_http' NOT NULL,
	"url" text NOT NULL,
	"auth" jsonb NOT NULL,
	"risk_policy" jsonb,
	"tool_risk_overrides" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
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
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"worker_id" uuid,
	"channel_overrides" jsonb DEFAULT '{}'::jsonb,
	"muted_categories" jsonb DEFAULT '[]'::jsonb,
	"digest_cadence" text DEFAULT 'immediate',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_notification_prefs_user_worker" UNIQUE("user_id","worker_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"worker_id" uuid,
	"session_id" uuid,
	"run_id" uuid,
	"category" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "repo_baseline_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_baseline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"status" text DEFAULT 'validating' NOT NULL,
	"version" text,
	"snapshot_id" text,
	"sandbox_provider" text,
	"setup_session_id" uuid,
	"install_commands" jsonb,
	"run_commands" jsonb,
	"test_commands" jsonb,
	"service_commands" jsonb,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_baselines_status_check" CHECK (status = ANY (ARRAY['validating'::text, 'ready'::text, 'stale'::text, 'failed'::text]))
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
	"repo_snapshot_id" text,
	"repo_snapshot_status" text,
	"repo_snapshot_error" text,
	"repo_snapshot_commit_sha" text,
	"repo_snapshot_built_at" timestamp with time zone,
	"repo_snapshot_provider" text,
	"service_commands" jsonb,
	"service_commands_updated_at" timestamp with time zone,
	"service_commands_updated_by" text,
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
	"configuration_id" uuid,
	CONSTRAINT "secrets_org_repo_configuration_key_unique" UNIQUE("organization_id","repo_id","key","configuration_id")
);
--> statement-breakpoint
CREATE TABLE "session_acl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_acl_session_user" UNIQUE("session_id","user_id"),
	CONSTRAINT "session_acl_role_check" CHECK (role = ANY (ARRAY['viewer'::text, 'editor'::text, 'reviewer'::text]))
);
--> statement-breakpoint
CREATE TABLE "session_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"capability_key" text NOT NULL,
	"mode" text DEFAULT 'allow' NOT NULL,
	"scope" jsonb,
	"origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_capabilities_session_key" UNIQUE("session_id","capability_key"),
	CONSTRAINT "session_capabilities_mode_check" CHECK (mode = ANY (ARRAY['allow'::text, 'require_approval'::text, 'deny'::text]))
);
--> statement-breakpoint
CREATE TABLE "session_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "session_connections_session_id_integration_id_key" UNIQUE("session_id","integration_id")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_events_type_check" CHECK (event_type = ANY (ARRAY['session_created'::text, 'session_started'::text, 'session_paused'::text, 'session_resumed'::text, 'session_completed'::text, 'session_failed'::text, 'session_cancelled'::text, 'session_outcome_persisted'::text, 'runtime_tool_started'::text, 'runtime_tool_finished'::text, 'runtime_approval_requested'::text, 'runtime_approval_resolved'::text, 'runtime_action_completed'::text, 'runtime_error'::text, 'chat_user_message'::text, 'chat_agent_response'::text, 'chat_job_tick'::text, 'chat_system'::text]))
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"message_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"delivery_state" text DEFAULT 'queued' NOT NULL,
	"dedupe_key" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deliver_after" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"sender_user_id" text,
	"sender_session_id" uuid,
	CONSTRAINT "session_messages_direction_check" CHECK (direction = ANY (ARRAY['user_to_manager'::text, 'user_to_task'::text, 'manager_to_task'::text, 'task_to_manager'::text])),
	CONSTRAINT "session_messages_delivery_state_check" CHECK (delivery_state = ANY (ARRAY['queued'::text, 'delivered'::text, 'consumed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "session_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"branch_name" text NOT NULL,
	"provider" text NOT NULL,
	"pull_request_number" integer,
	"pull_request_url" text,
	"pull_request_state" text,
	"head_commit_sha" text,
	"continued_from_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_pull_requests_state_check" CHECK (pull_request_state IS NULL OR pull_request_state = ANY (ARRAY['open'::text, 'closed'::text, 'merged'::text, 'draft'::text]))
);
--> statement-breakpoint
CREATE TABLE "session_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"config_json" jsonb,
	"origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_skills_session_key" UNIQUE("session_id","skill_key")
);
--> statement-breakpoint
CREATE TABLE "session_user_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_user_state_session_user" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid,
	"organization_id" text NOT NULL,
	"created_by" text,
	"session_type" text DEFAULT 'coding',
	"status" text DEFAULT 'starting',
	"sandbox_state" text DEFAULT 'provisioning' NOT NULL,
	"agent_state" text DEFAULT 'iterating' NOT NULL,
	"terminal_state" text,
	"state_reason" text,
	"state_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sandbox_id" text,
	"snapshot_id" text,
	"branch_name" text,
	"base_commit_sha" text,
	"parent_session_id" uuid,
	"initial_prompt" text,
	"title" text,
	"title_status" text,
	"initial_prompt_sent_at" timestamp with time zone,
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
	"sandbox_provider" text DEFAULT 'e2b' NOT NULL,
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
	"configuration_id" uuid,
	"idempotency_key" text,
	"sandbox_expires_at" timestamp with time zone,
	"metered_through_at" timestamp with time zone,
	"last_seen_alive_at" timestamp with time zone,
	"alive_check_failures" integer DEFAULT 0,
	"pause_reason" text,
	"stop_reason" text,
	"outcome" text,
	"summary" text,
	"pr_urls" jsonb,
	"metrics" jsonb,
	"latest_task" text,
	"kind" text,
	"runtime_status" text DEFAULT 'starting' NOT NULL,
	"operator_status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"worker_id" uuid,
	"worker_run_id" uuid,
	"repo_baseline_id" uuid,
	"repo_baseline_target_id" uuid,
	"capabilities_version" integer DEFAULT 1 NOT NULL,
	"continued_from_session_id" uuid,
	"rerun_of_session_id" uuid,
	"replaces_session_id" uuid,
	"replaced_by_session_id" uuid,
	"last_visible_update_at" timestamp with time zone,
	"outcome_json" jsonb,
	"outcome_version" integer,
	"outcome_persisted_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	CONSTRAINT "idx_sessions_automation_trigger_event" UNIQUE("automation_id","trigger_event_id"),
	CONSTRAINT "sessions_sandbox_provider_check" CHECK (sandbox_provider = ANY (ARRAY['modal'::text, 'e2b'::text])),
	CONSTRAINT "sessions_kind_check" CHECK (kind IS NULL OR kind = ANY (ARRAY['manager'::text, 'task'::text, 'setup'::text])),
	CONSTRAINT "sessions_runtime_status_check" CHECK (runtime_status = ANY (ARRAY['starting'::text, 'running'::text, 'paused'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])),
	CONSTRAINT "sessions_operator_status_check" CHECK (operator_status = ANY (ARRAY['active'::text, 'waiting_for_approval'::text, 'needs_input'::text, 'ready_for_review'::text, 'errored'::text, 'done'::text])),
	CONSTRAINT "sessions_visibility_v1_check" CHECK (visibility = ANY (ARRAY['private'::text, 'shared'::text, 'org'::text])),
	CONSTRAINT "sessions_manager_worker_run_null_check" CHECK ((kind != 'manager'::text) OR (worker_run_id IS NULL)),
	CONSTRAINT "sessions_manager_shape_check" CHECK ((kind != 'manager'::text) OR (worker_run_id IS NULL AND continued_from_session_id IS NULL AND rerun_of_session_id IS NULL)),
	CONSTRAINT "sessions_task_linkage_check" CHECK ((kind != 'task'::text) OR (configuration_id IS NULL) OR (repo_id IS NOT NULL AND repo_baseline_id IS NOT NULL AND repo_baseline_target_id IS NOT NULL)),
	CONSTRAINT "sessions_setup_requires_repo_check" CHECK ((kind != 'setup'::text) OR (repo_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "session_notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"slack_installation_id" uuid NOT NULL,
	"destination_type" text DEFAULT 'dm_user' NOT NULL,
	"slack_user_id" text,
	"event_types" jsonb DEFAULT '["completed"]'::jsonb,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "session_notification_subscriptions_session_user_key" UNIQUE("session_id","user_id"),
	CONSTRAINT "chk_session_notif_sub_dm_user_slack_id" CHECK ((destination_type != 'dm_user') OR (slack_user_id IS NOT NULL))
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
	"default_config_selection_strategy" text DEFAULT 'fixed',
	"default_configuration_id" uuid,
	"fallback_configuration_id" uuid,
	"allowed_configuration_ids" jsonb,
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
	"created_at" timestamp with time zone DEFAULT now(),
	"enriched_data" jsonb,
	"llm_filter_result" jsonb,
	"llm_analysis_result" jsonb
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
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_poll_groups_org_provider_integration" UNIQUE NULLS NOT DISTINCT("organization_id","provider","integration_id")
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
CREATE TABLE "wake_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"coalesced_into_wake_event_id" uuid,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "wake_events_source_check" CHECK (source = ANY (ARRAY['tick'::text, 'webhook'::text, 'manual'::text, 'manual_message'::text])),
	CONSTRAINT "wake_events_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'claimed'::text, 'consumed'::text, 'coalesced'::text, 'cancelled'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "worker_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"check_in_prompt" text NOT NULL,
	"cron_expression" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tick_at" timestamp with time zone,
	"next_tick_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_run_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"event_index" integer NOT NULL,
	"event_type" text NOT NULL,
	"summary_text" text,
	"payload_json" jsonb,
	"payload_version" integer DEFAULT 1,
	"session_id" uuid,
	"action_invocation_id" uuid,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_worker_run_events_run_index" UNIQUE("worker_run_id","event_index")
);
--> statement-breakpoint
CREATE TABLE "worker_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"manager_session_id" uuid NOT NULL,
	"wake_event_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uq_worker_runs_wake_event" UNIQUE("wake_event_id"),
	CONSTRAINT "worker_runs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'health_degraded'::text]))
);
--> statement-breakpoint
CREATE TABLE "worker_source_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"label" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"credential_owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_worker_source_bindings_worker_source" UNIQUE("worker_id","source_type","source_ref"),
	CONSTRAINT "worker_source_bindings_source_type_check" CHECK (source_type = ANY (ARRAY['sentry'::text, 'linear'::text, 'github'::text]))
);
--> statement-breakpoint
CREATE TABLE "worker_source_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"binding_id" uuid NOT NULL,
	"cursor_value" text,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_worker_source_cursors_binding" UNIQUE("binding_id")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text,
	"status" text DEFAULT 'active' NOT NULL,
	"manager_session_id" uuid NOT NULL,
	"model_id" text,
	"compute_profile" text,
	"last_error_code" text,
	"paused_at" timestamp with time zone,
	"paused_by" text,
	"created_by" text,
	"slack_channel_id" text,
	"slack_installation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workers_manager_session" UNIQUE("manager_session_id"),
	CONSTRAINT "workers_status_check" CHECK (status = ANY (ARRAY['active'::text, 'automations_paused'::text, 'degraded'::text, 'failed'::text, 'archived'::text]))
);
--> statement-breakpoint
ALTER TABLE "action_invocation_events" ADD CONSTRAINT "action_invocation_events_action_invocation_id_fkey" FOREIGN KEY ("action_invocation_id") REFERENCES "public"."action_invocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_invocations" ADD CONSTRAINT "action_invocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_invocations" ADD CONSTRAINT "action_invocations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_invocations" ADD CONSTRAINT "action_invocations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_intents" ADD CONSTRAINT "resume_intents_origin_session_id_fkey" FOREIGN KEY ("origin_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_intents" ADD CONSTRAINT "resume_intents_invocation_id_fkey" FOREIGN KEY ("invocation_id") REFERENCES "public"."action_invocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_action_preferences" ADD CONSTRAINT "user_action_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_action_preferences" ADD CONSTRAINT "user_action_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ssh_keys" ADD CONSTRAINT "user_ssh_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_connections" ADD CONSTRAINT "automation_connections_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_connections" ADD CONSTRAINT "automation_connections_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_events" ADD CONSTRAINT "automation_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_trigger_event_id_fkey" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."trigger_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_side_effects" ADD CONSTRAINT "automation_side_effects_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_side_effects" ADD CONSTRAINT "automation_side_effects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_default_configuration_id_fkey" FOREIGN KEY ("default_configuration_id") REFERENCES "public"."configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_notification_slack_installation_id_fkey" FOREIGN KEY ("notification_slack_installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reconciliations" ADD CONSTRAINT "billing_reconciliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reconciliations" ADD CONSTRAINT "billing_reconciliations_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_spend_cursors" ADD CONSTRAINT "llm_spend_cursors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_repos" ADD CONSTRAINT "configuration_repos_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_repos" ADD CONSTRAINT "configuration_repos_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_connectors" ADD CONSTRAINT "org_connectors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_connectors" ADD CONSTRAINT "org_connectors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_connections" ADD CONSTRAINT "repo_connections_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_connections" ADD CONSTRAINT "repo_connections_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baseline_targets" ADD CONSTRAINT "repo_baseline_targets_repo_baseline_id_fkey" FOREIGN KEY ("repo_baseline_id") REFERENCES "public"."repo_baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_setup_session_id_sessions_id_fk" FOREIGN KEY ("setup_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_baselines" ADD CONSTRAINT "repo_baselines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_secrets" ADD CONSTRAINT "configuration_secrets_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_secrets" ADD CONSTRAINT "configuration_secrets_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_acl" ADD CONSTRAINT "session_acl_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_acl" ADD CONSTRAINT "session_acl_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_capabilities" ADD CONSTRAINT "session_capabilities_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pull_requests" ADD CONSTRAINT "session_pull_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pull_requests" ADD CONSTRAINT "session_pull_requests_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pull_requests" ADD CONSTRAINT "session_pull_requests_continued_from_session_id_fkey" FOREIGN KEY ("continued_from_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_skills" ADD CONSTRAINT "session_skills_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_user_state" ADD CONSTRAINT "session_user_state_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_user_state" ADD CONSTRAINT "session_user_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_trigger_event_id_trigger_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."trigger_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_worker_run_id_worker_runs_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."worker_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_baseline_id_repo_baselines_id_fk" FOREIGN KEY ("repo_baseline_id") REFERENCES "public"."repo_baselines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_baseline_target_id_repo_baseline_targets_id_fk" FOREIGN KEY ("repo_baseline_target_id") REFERENCES "public"."repo_baseline_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_archived_by_user_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_continued_from_session_id_fkey" FOREIGN KEY ("continued_from_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rerun_of_session_id_fkey" FOREIGN KEY ("rerun_of_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_replaces_session_id_fkey" FOREIGN KEY ("replaces_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_replaced_by_session_id_fkey" FOREIGN KEY ("replaced_by_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notification_subscriptions" ADD CONSTRAINT "session_notification_subscriptions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notification_subscriptions" ADD CONSTRAINT "session_notification_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_notification_subscriptions" ADD CONSTRAINT "session_notification_subscriptions_slack_installation_id_fkey" FOREIGN KEY ("slack_installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversations" ADD CONSTRAINT "slack_conversations_slack_installation_id_fkey" FOREIGN KEY ("slack_installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversations" ADD CONSTRAINT "slack_conversations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_conversations" ADD CONSTRAINT "slack_conversations_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_installed_by_fkey" FOREIGN KEY ("installed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_default_configuration_id_fkey" FOREIGN KEY ("default_configuration_id") REFERENCES "public"."configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_fallback_configuration_id_fkey" FOREIGN KEY ("fallback_configuration_id") REFERENCES "public"."configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD CONSTRAINT "trigger_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD CONSTRAINT "trigger_events_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD CONSTRAINT "trigger_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_coalesced_into_wake_event_id_fkey" FOREIGN KEY ("coalesced_into_wake_event_id") REFERENCES "public"."wake_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_run_events" ADD CONSTRAINT "worker_run_events_worker_run_id_fkey" FOREIGN KEY ("worker_run_id") REFERENCES "public"."worker_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_run_events" ADD CONSTRAINT "worker_run_events_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_manager_session_id_fkey" FOREIGN KEY ("manager_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_runs" ADD CONSTRAINT "worker_runs_wake_event_id_fkey" FOREIGN KEY ("wake_event_id") REFERENCES "public"."wake_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_source_bindings" ADD CONSTRAINT "worker_source_bindings_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_source_bindings" ADD CONSTRAINT "worker_source_bindings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_source_cursors" ADD CONSTRAINT "worker_source_cursors_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "public"."worker_source_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_manager_session_id_fkey" FOREIGN KEY ("manager_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_slack_installation_id_fkey" FOREIGN KEY ("slack_installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_action_invocation_events_invocation" ON "action_invocation_events" USING btree ("action_invocation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_action_invocation_events_type" ON "action_invocation_events" USING btree ("event_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_action_invocations_session" ON "action_invocations" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_action_invocations_org_created" ON "action_invocations" USING btree ("organization_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_action_invocations_status_expires" ON "action_invocations" USING btree ("status" text_ops,"expires_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_resume_intents_origin_session" ON "resume_intents" USING btree ("origin_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_resume_intents_invocation" ON "resume_intents" USING btree ("invocation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_resume_intents_status" ON "resume_intents" USING btree ("status" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_resume_intents_one_active" ON "resume_intents" USING btree ("origin_session_id","invocation_id") WHERE status NOT IN ('satisfied', 'continued', 'resume_failed');--> statement-breakpoint
CREATE INDEX "idx_user_action_prefs_user_org" ON "user_action_preferences" USING btree ("user_id" text_ops,"organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organizationId" text_ops);--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organizationId" text_ops);--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "organization_allowed_domains_idx" ON "organization" USING gin ("allowed_domains" array_ops);--> statement-breakpoint
CREATE INDEX "organization_autumn_customer_idx" ON "organization" USING btree ("autumn_customer_id" text_ops) WHERE (autumn_customer_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug" text_ops);--> statement-breakpoint
CREATE INDEX "organization_billing_state_idx" ON "organization" USING btree ("billing_state" text_ops);--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId" text_ops);--> statement-breakpoint
CREATE INDEX "idx_user_ssh_keys_user" ON "user_ssh_keys" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier" text_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_connections_automation" ON "automation_connections" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_connections_integration" ON "automation_connections" USING btree ("integration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_run_events_run" ON "automation_run_events" USING btree ("run_id" uuid_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_runs_status_lease" ON "automation_runs" USING btree ("status" text_ops,"lease_expires_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_runs_org_status" ON "automation_runs" USING btree ("organization_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_runs_session" ON "automation_runs" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_automation_runs_trigger_event" ON "automation_runs" USING btree ("trigger_event_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_runs_assigned_to" ON "automation_runs" USING btree ("assigned_to" text_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_side_effects_run" ON "automation_side_effects" USING btree ("run_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_automations_enabled" ON "automations" USING btree ("enabled" bool_ops) WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "idx_automations_org" ON "automations" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_automations_configuration" ON "automations" USING btree ("default_configuration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_automations_worker_id" ON "automations" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_outbox_status_available" ON "outbox" USING btree ("status" text_ops,"available_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_org" ON "billing_events" USING btree ("organization_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_outbox" ON "billing_events" USING btree ("status" text_ops,"next_retry_at" timestamptz_ops) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));--> statement-breakpoint
CREATE INDEX "idx_billing_events_session" ON "billing_events" USING gin ("session_ids" array_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_type" ON "billing_events" USING btree ("organization_id" text_ops,"event_type" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_reconciliations_org" ON "billing_reconciliations" USING btree ("organization_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_reconciliations_type" ON "billing_reconciliations" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_configuration_repos_configuration" ON "configuration_repos" USING btree ("configuration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_configuration_repos_repo" ON "configuration_repos" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_configurations_sandbox_provider" ON "configurations" USING btree ("sandbox_provider" text_ops);--> statement-breakpoint
CREATE INDEX "idx_configurations_type_managed" ON "configurations" USING btree ("type" text_ops) WHERE (type = 'managed'::text);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sandbox_base_snapshots_version_provider_app" ON "sandbox_base_snapshots" USING btree ("version_key" text_ops,"provider" text_ops,"modal_app_name" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sandbox_base_snapshots_status" ON "sandbox_base_snapshots" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_integrations_github_installation" ON "integrations" USING btree ("github_installation_id" text_ops) WHERE (github_installation_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_integrations_org" ON "integrations" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_org_connectors_org" ON "org_connectors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_repo_connections_integration" ON "repo_connections" USING btree ("integration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_repo_connections_repo" ON "repo_connections" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notification_prefs_org_user" ON "notification_preferences" USING btree ("organization_id" text_ops,"user_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_status" ON "notifications" USING btree ("user_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_org_user" ON "notifications" USING btree ("organization_id" text_ops,"user_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_worker" ON "notifications" USING btree ("worker_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_session" ON "notifications" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notifications_idempotency_key" ON "notifications" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_repo_baseline_targets_baseline" ON "repo_baseline_targets" USING btree ("repo_baseline_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_repo_baselines_repo" ON "repo_baselines" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_repo_baselines_one_active_per_repo" ON "repo_baselines" USING btree ("repo_id") WHERE status = 'ready';--> statement-breakpoint
CREATE INDEX "idx_repos_local_path_hash" ON "repos" USING btree ("local_path_hash" text_ops) WHERE (local_path_hash IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_repos_org" ON "repos" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_repos_repo_snapshot_status" ON "repos" USING btree ("repo_snapshot_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_schedules_automation" ON "schedules" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_schedules_next_run" ON "schedules" USING btree ("next_run_at" timestamptz_ops) WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "idx_schedules_org" ON "schedules" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_configuration_secrets_configuration" ON "configuration_secrets" USING btree ("configuration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_configuration_secrets_secret" ON "configuration_secrets" USING btree ("secret_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_secret_files_org" ON "secret_files" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_secret_files_configuration" ON "secret_files" USING btree ("configuration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_secrets_org" ON "secrets" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_secrets_repo" ON "secrets" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_acl_session" ON "session_acl" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_acl_user" ON "session_acl" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_session_capabilities_session" ON "session_capabilities" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_connections_session" ON "session_connections" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_connections_integration" ON "session_connections" USING btree ("integration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_events_session" ON "session_events" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_events_type" ON "session_events" USING btree ("event_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_session_events_chat_history" ON "session_events" USING btree ("session_id" uuid_ops,"event_type" text_ops,"created_at");--> statement-breakpoint
CREATE INDEX "idx_session_messages_session" ON "session_messages" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_messages_delivery_state" ON "session_messages" USING btree ("delivery_state" text_ops);--> statement-breakpoint
CREATE INDEX "idx_session_messages_session_state" ON "session_messages" USING btree ("session_id" uuid_ops,"delivery_state" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_messages_dedupe" ON "session_messages" USING btree ("session_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_session_pull_requests_session" ON "session_pull_requests" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_pull_requests_repo" ON "session_pull_requests" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_skills_session" ON "session_skills" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_user_state_session" ON "session_user_state" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_user_state_user" ON "session_user_state" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_automation" ON "sessions" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_client_type" ON "sessions" USING btree ("client_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_local_path_hash" ON "sessions" USING btree ("local_path_hash" text_ops) WHERE (local_path_hash IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_sessions_org" ON "sessions" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_parent" ON "sessions" USING btree ("parent_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_configuration" ON "sessions" USING btree ("configuration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_repo" ON "sessions" USING btree ("repo_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_sandbox_expires_at" ON "sessions" USING btree ("sandbox_expires_at" timestamptz_ops) WHERE (sandbox_expires_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_sessions_sandbox_provider" ON "sessions" USING btree ("sandbox_provider" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_slack_lookup" ON "sessions" USING btree (((client_metadata ->> 'installationId'::text)),((client_metadata ->> 'channelId'::text)),((client_metadata ->> 'threadTs'::text))) WHERE (client_type = 'slack'::text);--> statement-breakpoint
CREATE INDEX "idx_sessions_status" ON "sessions" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_trigger" ON "sessions" USING btree ("trigger_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_kind" ON "sessions" USING btree ("kind" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_runtime_status" ON "sessions" USING btree ("runtime_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_operator_status" ON "sessions" USING btree ("operator_status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_worker" ON "sessions" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_sessions_worker_run" ON "sessions" USING btree ("worker_run_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_one_active_setup_per_repo" ON "sessions" USING btree ("repo_id") WHERE kind = 'setup' AND runtime_status NOT IN ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "idx_session_notif_sub_session" ON "session_notification_subscriptions" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_notif_sub_user" ON "session_notification_subscriptions" USING btree ("user_id" text_ops);--> statement-breakpoint
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
CREATE INDEX "idx_trigger_poll_groups_org" ON "trigger_poll_groups" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_trigger_poll_groups_enabled" ON "trigger_poll_groups" USING btree ("enabled" bool_ops);--> statement-breakpoint
CREATE INDEX "idx_triggers_automation" ON "triggers" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_triggers_enabled_polling" ON "triggers" USING btree ("enabled" bool_ops,"trigger_type" text_ops) WHERE ((trigger_type = 'polling'::text) AND (enabled = true));--> statement-breakpoint
CREATE INDEX "idx_triggers_enabled_scheduled" ON "triggers" USING btree ("enabled" bool_ops,"provider" text_ops) WHERE ((provider = 'scheduled'::text) AND (enabled = true));--> statement-breakpoint
CREATE INDEX "idx_triggers_org" ON "triggers" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_triggers_repeat_job_key" ON "triggers" USING btree ("repeat_job_key" text_ops) WHERE (repeat_job_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_triggers_webhook_path" ON "triggers" USING btree ("webhook_url_path" text_ops);--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_status" ON "webhook_inbox" USING btree ("status" text_ops,"received_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_provider" ON "webhook_inbox" USING btree ("provider" text_ops);--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_org" ON "webhook_inbox" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_worker" ON "wake_events" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_status" ON "wake_events" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_worker_status" ON "wake_events" USING btree ("worker_id" uuid_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_wake_events_org" ON "wake_events" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_jobs_worker" ON "worker_jobs" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_jobs_org" ON "worker_jobs" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_run_events_run" ON "worker_run_events" USING btree ("worker_run_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_run_events_worker" ON "worker_run_events" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_worker_run_events_dedupe" ON "worker_run_events" USING btree ("worker_run_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_worker_runs_worker" ON "worker_runs" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_runs_status" ON "worker_runs" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_runs_org" ON "worker_runs" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_worker_runs_one_active_per_worker" ON "worker_runs" USING btree ("worker_id") WHERE status NOT IN ('completed', 'failed', 'cancelled', 'health_degraded');--> statement-breakpoint
CREATE INDEX "idx_worker_source_bindings_worker" ON "worker_source_bindings" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_worker_source_bindings_org" ON "worker_source_bindings" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_workers_org" ON "workers" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_workers_status" ON "workers" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_workers_manager_session" ON "workers" USING btree ("manager_session_id" uuid_ops);--> statement-breakpoint
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
