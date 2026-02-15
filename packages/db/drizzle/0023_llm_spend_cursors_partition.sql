-- Archive the global singleton cursor table
ALTER TABLE "llm_spend_cursors" RENAME TO "llm_spend_cursors_global";

-- Create per-org partitioned cursor table
CREATE TABLE "llm_spend_cursors" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"last_start_time" timestamp with time zone NOT NULL,
	"last_request_id" text,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "llm_spend_cursors" ADD CONSTRAINT "llm_spend_cursors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
