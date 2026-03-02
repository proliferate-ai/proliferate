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
	CONSTRAINT "worker_source_bindings_source_type_check" CHECK (source_type = ANY (ARRAY['sentry'::text, 'linear'::text, 'github'::text])),
	CONSTRAINT "uq_worker_source_bindings_worker_source" UNIQUE("worker_id", "source_type", "source_ref")
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
ALTER TABLE "worker_source_bindings" ADD CONSTRAINT "worker_source_bindings_worker_id_fkey"
	FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "worker_source_bindings" ADD CONSTRAINT "worker_source_bindings_organization_id_fkey"
	FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "worker_source_cursors" ADD CONSTRAINT "worker_source_cursors_binding_id_fkey"
	FOREIGN KEY ("binding_id") REFERENCES "public"."worker_source_bindings"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "idx_worker_source_bindings_worker" ON "worker_source_bindings" USING btree ("worker_id");
--> statement-breakpoint
CREATE INDEX "idx_worker_source_bindings_org" ON "worker_source_bindings" USING btree ("organization_id");
