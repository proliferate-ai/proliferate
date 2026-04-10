import {
  connectorSupportsCloudSecretSync,
  getConnectorCatalogEntry,
  isConnectorCatalogEntryActive,
} from "@/lib/domain/mcp/catalog";
import type { SavedConnectorMetadata } from "@/lib/domain/mcp/types";
import {
  loadConnectorSecretValue,
  readConnectorState,
  updateConnectorSyncState,
  writeConnectorState,
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
  let pendingDeletesChanged = false;

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

  let nextState = await readConnectorState();
  for (const tombstone of nextState.pendingDeletes) {
    try {
      await deleteCloudMcpConnection(tombstone.connectionId);
      nextState = {
        ...nextState,
        pendingDeletes: nextState.pendingDeletes.filter(
          (item) => item.connectionId !== tombstone.connectionId,
        ),
      };
      changed = true;
      pendingDeletesChanged = true;
    } catch {
      nextState = {
        ...nextState,
        pendingDeletes: nextState.pendingDeletes.map((item) => (
          item.connectionId === tombstone.connectionId
            ? { ...item, lastAttemptAt: new Date().toISOString() }
            : item
        )),
      };
      pendingDeletesChanged = true;
    }
  }

  if (changed || pendingDeletesChanged) {
    await writeConnectorState(nextState);
  }
  return changed;
}
