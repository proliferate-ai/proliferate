import {
  connectorSupportsCloudSecretSync,
  getConnectorCatalogEntry,
  isConnectorCatalogEntryActive,
} from "@/lib/domain/mcp/catalog";
import type { SavedConnectorMetadata } from "@/lib/domain/mcp/types";
import {
  loadConnectorSecretValue,
  mutateConnectorState,
  readConnectorState,
  updateConnectorSyncState,
} from "@/lib/infra/mcp/state";
import {
  deleteCloudMcpConnection,
  syncCloudMcpConnection,
} from "@/lib/integrations/cloud/mcp_connections";

export async function syncConnectorReplica(metadata: SavedConnectorMetadata): Promise<boolean> {
  const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
  if (!catalogEntry || !isConnectorCatalogEntryActive(catalogEntry)) {
    return false;
  }
  if (!connectorSupportsCloudSecretSync(catalogEntry)) {
    await updateConnectorSyncState(metadata.connectionId, "synced", new Date().toISOString());
    return true;
  }

  const secretFields: Record<string, string> = {};
  for (const field of catalogEntry.requiredFields) {
    const value = await loadConnectorSecretValue(metadata.connectionId, field.id);
    if (!value) {
      return false;
    }
    secretFields[field.id] = value;
  }

  await syncCloudMcpConnection(metadata.connectionId, {
    catalogEntryId: catalogEntry.id,
    secretFields,
  });
  await updateConnectorSyncState(metadata.connectionId, "synced", new Date().toISOString());
  return true;
}

export async function retryConnectorSync(connectionId: string): Promise<boolean> {
  const state = await readConnectorState();
  const metadata = state.connections.find((item) => item.connectionId === connectionId) ?? null;
  if (!metadata) {
    return false;
  }
  const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
  if (!catalogEntry || !connectorSupportsCloudSecretSync(catalogEntry)) {
    return true;
  }
  try {
    return await syncConnectorReplica(metadata);
  } catch {
    return false;
  }
}

export async function retryPendingConnectorSync(): Promise<boolean> {
  const state = await readConnectorState();
  let changed = false;
  const deletedConnectionIds = new Set<string>();
  const failedDeleteIds = new Set<string>();

  for (const metadata of state.connections) {
    if (metadata.syncState !== "degraded") {
      continue;
    }
    try {
      const synced = await syncConnectorReplica(metadata);
      changed = changed || synced;
    } catch {
      // Keep degraded state for future retries.
    }
  }

  const latestState = await readConnectorState();
  for (const tombstone of latestState.pendingDeletes) {
    try {
      await deleteCloudMcpConnection(tombstone.connectionId);
      changed = true;
      deletedConnectionIds.add(tombstone.connectionId);
    } catch {
      failedDeleteIds.add(tombstone.connectionId);
    }
  }

  if (deletedConnectionIds.size > 0 || failedDeleteIds.size > 0) {
    await mutateConnectorState((latestState) => ({
      state: {
        ...latestState,
        pendingDeletes: latestState.pendingDeletes
          .filter((item) => !deletedConnectionIds.has(item.connectionId))
          .map((item) => (
            failedDeleteIds.has(item.connectionId)
              ? { ...item, lastAttemptAt: new Date().toISOString() }
              : item
          )),
      },
      result: undefined,
    }));
  }
  return changed;
}
