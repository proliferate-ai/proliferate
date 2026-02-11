CREATE TABLE "action_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"session_id" uuid,
	"integration" text NOT NULL,
	"action" text NOT NULL,
	"max_calls" integer,
	"used_calls" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "action_grants" ADD CONSTRAINT "action_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_grants" ADD CONSTRAINT "action_grants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_grants" ADD CONSTRAINT "action_grants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_action_grants_org" ON "action_grants" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_action_grants_lookup" ON "action_grants" USING btree ("organization_id" text_ops,"integration" text_ops,"action" text_ops);