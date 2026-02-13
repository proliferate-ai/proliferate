ALTER TABLE "prebuilds" ADD COLUMN "connectors" jsonb;
ALTER TABLE "prebuilds" ADD COLUMN "connectors_updated_at" timestamp with time zone;
ALTER TABLE "prebuilds" ADD COLUMN "connectors_updated_by" text;
