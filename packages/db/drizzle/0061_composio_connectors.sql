ALTER TABLE org_connectors ADD COLUMN composio_toolkit text;
ALTER TABLE org_connectors ADD COLUMN composio_account_id text;
CREATE UNIQUE INDEX org_connectors_composio_toolkit_org_unique
  ON org_connectors (organization_id, composio_toolkit)
  WHERE composio_toolkit IS NOT NULL;
