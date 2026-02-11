CREATE TABLE "secret_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "secret_bundles_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE INDEX "idx_secret_bundles_org" ON "secret_bundles" USING btree ("organization_id" text_ops ASC NULLS LAST);--> statement-breakpoint
ALTER TABLE "secret_bundles" ADD CONSTRAINT "secret_bundles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_bundles" ADD CONSTRAINT "secret_bundles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "bundle_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_secrets_bundle" ON "secrets" USING btree ("bundle_id" uuid_ops ASC NULLS LAST);--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "public"."secret_bundles"("id") ON DELETE set null ON UPDATE no action;
