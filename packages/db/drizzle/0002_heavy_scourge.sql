CREATE TABLE "automation_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "automation_connections_automation_id_integration_id_key" UNIQUE("automation_id","integration_id")
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
ALTER TABLE "automation_connections" DROP CONSTRAINT IF EXISTS "automation_connections_automation_id_fkey";--> statement-breakpoint
ALTER TABLE "automation_connections" ADD CONSTRAINT "automation_connections_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_connections" DROP CONSTRAINT IF EXISTS "automation_connections_integration_id_fkey";--> statement-breakpoint
ALTER TABLE "automation_connections" ADD CONSTRAINT "automation_connections_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_connections" DROP CONSTRAINT IF EXISTS "session_connections_session_id_fkey";--> statement-breakpoint
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_connections" DROP CONSTRAINT IF EXISTS "session_connections_integration_id_fkey";--> statement-breakpoint
ALTER TABLE "session_connections" ADD CONSTRAINT "session_connections_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_automation_connections_automation" ON "automation_connections" USING btree ("automation_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_automation_connections_integration" ON "automation_connections" USING btree ("integration_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_connections_session" ON "session_connections" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_session_connections_integration" ON "session_connections" USING btree ("integration_id" uuid_ops);--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "idx_sessions_automation_trigger_event";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "idx_sessions_automation_trigger_event" UNIQUE("automation_id","trigger_event_id");
