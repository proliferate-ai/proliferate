CREATE TABLE "action_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" uuid,
	"integration" text NOT NULL,
	"action" text NOT NULL,
	"risk_level" text NOT NULL,
	"params" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"duration_ms" integer,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "action_invocations" ADD CONSTRAINT "action_invocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_invocations" ADD CONSTRAINT "action_invocations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_invocations" ADD CONSTRAINT "action_invocations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_action_invocations_session" ON "action_invocations" USING btree ("session_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_action_invocations_org_created" ON "action_invocations" USING btree ("organization_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_action_invocations_status_expires" ON "action_invocations" USING btree ("status" text_ops,"expires_at" timestamptz_ops);