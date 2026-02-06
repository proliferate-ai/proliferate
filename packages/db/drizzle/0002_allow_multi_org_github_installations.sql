-- Allow multiple orgs to share the same GitHub App installation
-- Drop the old unique constraint on just connection_id
ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "integrations_connection_id_key";

-- Add new composite unique constraint on (connection_id, organization_id)
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_connection_id_organization_id_key" UNIQUE ("connection_id", "organization_id");
