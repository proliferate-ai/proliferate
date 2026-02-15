-- Webhook inbox: decouples webhook HTTP handlers from processing.
-- Trigger poll groups: integration-scoped polling instead of per-trigger.

CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_type" text,
	"identity_kind" text NOT NULL,
	"identity_value" text NOT NULL,
	"headers" jsonb,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_inbox_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'completed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "trigger_poll_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"integration_id" uuid,
	"cursor" jsonb,
	"interval_seconds" integer NOT NULL,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "idx_trigger_poll_groups_unique" UNIQUE("organization_id","provider","integration_id")
);
--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_status_next_attempt" ON "webhook_inbox" USING btree ("status" text_ops ASC NULLS LAST,"next_attempt_at" timestamptz_ops ASC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "idx_webhook_inbox_received" ON "webhook_inbox" USING btree ("received_at" timestamptz_ops ASC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "idx_trigger_poll_groups_org" ON "trigger_poll_groups" USING btree ("organization_id" text_ops ASC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trigger_poll_groups" ADD CONSTRAINT "trigger_poll_groups_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
