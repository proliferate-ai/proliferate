ALTER TABLE "integrations"
ADD COLUMN IF NOT EXISTS "encrypted_access_token" text;

ALTER TABLE "integrations"
ADD COLUMN IF NOT EXISTS "encrypted_refresh_token" text;

ALTER TABLE "integrations"
ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp with time zone;

ALTER TABLE "integrations"
ADD COLUMN IF NOT EXISTS "token_type" text;

ALTER TABLE "integrations"
ADD COLUMN IF NOT EXISTS "connection_metadata" jsonb;
