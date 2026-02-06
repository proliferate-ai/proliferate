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
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"last_start_time" timestamp with time zone NOT NULL,
	"last_request_id" text,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "fk_sessions_trigger_event";
--> statement-breakpoint
ALTER TABLE "trigger_events" DROP CONSTRAINT "trigger_events_session_id_fkey";
--> statement-breakpoint
DROP INDEX "idx_billing_events_org";--> statement-breakpoint
DROP INDEX "idx_billing_events_outbox";--> statement-breakpoint
DROP INDEX "idx_billing_events_type";--> statement-breakpoint
DROP INDEX "idx_trigger_events_queued";--> statement-breakpoint
DROP INDEX "idx_trigger_events_skipped";--> statement-breakpoint
DROP INDEX "idx_triggers_enabled_polling";--> statement-breakpoint
DROP INDEX "idx_triggers_enabled_scheduled";--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_state" text DEFAULT 'unconfigured' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_plan" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "shadow_balance" numeric(12, 6) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "shadow_balance_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "grace_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "grace_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_reconciliations" ADD CONSTRAINT "billing_reconciliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reconciliations" ADD CONSTRAINT "billing_reconciliations_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_billing_reconciliations_org" ON "billing_reconciliations" USING btree ("organization_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_reconciliations_type" ON "billing_reconciliations" USING btree ("type" text_ops);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_trigger_event_id_trigger_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."trigger_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_events" ADD CONSTRAINT "trigger_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_billing_state_idx" ON "organization" USING btree ("billing_state" text_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_org" ON "billing_events" USING btree ("organization_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_billing_events_outbox" ON "billing_events" USING btree ("status" text_ops,"next_retry_at" timestamptz_ops) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));--> statement-breakpoint
CREATE INDEX "idx_billing_events_type" ON "billing_events" USING btree ("organization_id" text_ops,"event_type" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_trigger_events_queued" ON "trigger_events" USING btree ("status" text_ops,"created_at" timestamptz_ops) WHERE (status = 'queued'::text);--> statement-breakpoint
CREATE INDEX "idx_trigger_events_skipped" ON "trigger_events" USING btree ("trigger_id" uuid_ops,"status" text_ops) WHERE (status = 'skipped'::text);--> statement-breakpoint
CREATE INDEX "idx_triggers_enabled_polling" ON "triggers" USING btree ("enabled" bool_ops,"trigger_type" text_ops) WHERE ((trigger_type = 'polling'::text) AND (enabled = true));--> statement-breakpoint
CREATE INDEX "idx_triggers_enabled_scheduled" ON "triggers" USING btree ("enabled" bool_ops,"provider" text_ops) WHERE ((provider = 'scheduled'::text) AND (enabled = true));