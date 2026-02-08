ALTER TABLE "prebuilds" ADD COLUMN "service_commands" jsonb;
ALTER TABLE "prebuilds" ADD COLUMN "service_commands_updated_at" timestamptz;
ALTER TABLE "prebuilds" ADD COLUMN "service_commands_updated_by" text;
