-- Drop dead billing_token_version column from sessions table.
-- This column was part of the removed billing token subsystem and is never
-- read or written by any code path. See billing-metering.md §6.13.
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "billing_token_version";
