CREATE TABLE "user_action_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" text NOT NULL,
	"action_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_action_prefs_user_org_source_action_key" UNIQUE("user_id","organization_id","source_id","action_id")
);
--> statement-breakpoint
ALTER TABLE "user_action_preferences" ADD CONSTRAINT "user_action_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_action_preferences" ADD CONSTRAINT "user_action_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_action_prefs_user_org" ON "user_action_preferences" USING btree ("user_id" text_ops,"organization_id" text_ops);