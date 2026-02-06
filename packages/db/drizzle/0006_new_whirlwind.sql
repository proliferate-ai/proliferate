-- Add assigned_to and assigned_at columns to automation_runs for run claiming

ALTER TABLE "automation_runs" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_automation_runs_assigned_to" ON "automation_runs" USING btree ("assigned_to" text_ops);
