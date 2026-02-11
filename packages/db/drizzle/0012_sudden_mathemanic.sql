ALTER TABLE "prebuilds" ADD COLUMN "env_files" jsonb;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "env_files_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prebuilds" ADD COLUMN "env_files_updated_by" text;
