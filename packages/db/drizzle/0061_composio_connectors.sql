ALTER TABLE org_connectors ADD COLUMN composio_toolkit text;
ALTER TABLE org_connectors ADD COLUMN composio_account_id text;
CREATE UNIQUE INDEX org_connectors_composio_toolkit_org_unique
  ON org_connectors (organization_id, composio_toolkit)
  WHERE composio_toolkit IS NOT NULL;
ALTER TABLE org_connectors ADD CONSTRAINT org_connectors_composio_managed_shape_check
  CHECK ((composio_toolkit IS NULL AND composio_account_id IS NULL)
      OR (composio_toolkit IS NOT NULL AND composio_account_id IS NOT NULL));
