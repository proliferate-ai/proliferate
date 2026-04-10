import {
  connectorSupportsCloudSecretSync,
  getConnectorCatalogEntry,
  getPrimarySecretField,
  isConnectorCatalogEntryActive,
} from "@/lib/domain/mcp/catalog";
import { generateConnectorServerName } from "@/lib/domain/mcp/server-name";
import { normalizeConnectorSecretValue, validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import type {
  ConnectorCatalogEntry,
  InstalledConnectorRecord,
  SavedConnectorMetadata,
} from "@/lib/domain/mcp/types";
import {
  listAvailableConnectorEntries,
  listInstalledConnectorRecords,
  loadConnectorSecretValue,
  readConnectorState,
  updateConnectorSyncState,
  writeConnectorState,
} from "@/lib/infra/mcp/state";
import { syncConnectorReplica } from "@/lib/infra/mcp/sync";
import { deleteCloudMcpConnection } from "@/lib/integrations/cloud/mcp_connections";
import { deleteConnectorSecret, setConnectorSecret } from "@/platform/tauri/connectors";

export interface ConnectorPaneData {
  installed: InstalledConnectorRecord[];
  available: readonly ConnectorCatalogEntry[];
}

export async function loadConnectorPaneData(): Promise<ConnectorPaneData> {
  const [installed, available] = await Promise.all([
    listInstalledConnectorRecords(),
    listAvailableConnectorEntries(),
  ]);
  return { installed, available };
}

function connectorWriteFailureMessage(name: string): string {
  return `Couldn't save ${name}. Try again.`;
}

async function ensureConnectorSecretRoundTrip(
  connectionId: string,
  fieldId: string,
  expectedValue: string,
  connectorName: string,
): Promise<void> {
  // The native keychain can occasionally report a successful write while a
  // follow-up read still returns no value, so connector install/update only
  // succeeds after we verify the just-written secret is actually readable.
  const storedValue = await loadConnectorSecretValue(connectionId, fieldId);
  if (storedValue !== expectedValue) {
    throw new Error(connectorWriteFailureMessage(connectorName));
  }
}

export async function installConnector(
  catalogEntryId: string,
  secretValue: string,
): Promise<{ degraded: boolean }> {
  const catalogEntry = getConnectorCatalogEntry(catalogEntryId);
  if (!catalogEntry) {
    throw new Error("Connector catalog entry was not found.");
  }
  if (!isConnectorCatalogEntryActive(catalogEntry)) {
    throw new Error(`${catalogEntry.name} isn't available yet.`);
  }

  const state = await readConnectorState();
  if (state.connections.some((item) => item.catalogEntryId === catalogEntry.id)) {
    throw new Error(`${catalogEntry.name} is already connected.`);
  }

  const field = getPrimarySecretField(catalogEntry);
  const normalizedSecret = field ? normalizeConnectorSecretValue(secretValue) : "";
  if (field) {
    const validationError = validateConnectorSecretValue(normalizedSecret);
    if (validationError) {
      throw new Error(validationError);
    }
  }

  const connectionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata: SavedConnectorMetadata = {
    connectionId,
    catalogEntryId: catalogEntry.id,
    enabled: true,
    serverName: generateConnectorServerName(catalogEntry.serverNameBase, connectionId, state.connections),
    syncState: connectorSupportsCloudSecretSync(catalogEntry) ? "degraded" : "synced",
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: connectorSupportsCloudSecretSync(catalogEntry) ? null : now,
  };

  if (field) {
    await setConnectorSecret(connectionId, field.id, normalizedSecret);
    try {
      await ensureConnectorSecretRoundTrip(
        connectionId,
        field.id,
        normalizedSecret,
        catalogEntry.name,
      );
    } catch (error) {
      await deleteConnectorSecret(connectionId, field.id).catch(() => undefined);
      throw error;
    }
  }

  try {
    await writeConnectorState({
      ...state,
      connections: [...state.connections, metadata],
    });
  } catch (error) {
    if (field) {
      await deleteConnectorSecret(connectionId, field.id).catch(() => undefined);
    }
    throw error;
  }

  if (!connectorSupportsCloudSecretSync(catalogEntry)) {
    return { degraded: false };
  }

  try {
    const synced = await syncConnectorReplica(metadata);
    return { degraded: !synced };
  } catch {
    return { degraded: true };
  }
}

export async function updateConnectorSecret(
  connectionId: string,
  secretValue: string,
): Promise<{ degraded: boolean }> {
  const state = await readConnectorState();
  const metadata = state.connections.find((item) => item.connectionId === connectionId) ?? null;
  if (!metadata) {
    throw new Error("Connector was not found.");
  }
  const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
  if (!catalogEntry) {
    throw new Error("Connector catalog entry was not found.");
  }
  const field = getPrimarySecretField(catalogEntry);
  if (!field) {
    throw new Error(`${catalogEntry.name} doesn't store a token.`);
  }

  const normalizedSecret = normalizeConnectorSecretValue(secretValue);
  const validationError = validateConnectorSecretValue(normalizedSecret);
  if (validationError) {
    throw new Error(validationError);
  }

  await setConnectorSecret(connectionId, field.id, normalizedSecret);
  await ensureConnectorSecretRoundTrip(
    connectionId,
    field.id,
    normalizedSecret,
    catalogEntry.name,
  );
  await updateConnectorSyncState(connectionId, "degraded", metadata.lastSyncedAt);
  try {
    const synced = await syncConnectorReplica({
      ...metadata,
      syncState: "degraded",
    });
    return { degraded: !synced };
  } catch {
    return { degraded: true };
  }
}

export async function setConnectorEnabled(
  connectionId: string,
  enabled: boolean,
): Promise<void> {
  const state = await readConnectorState();
  await writeConnectorState({
    ...state,
    connections: state.connections.map((metadata) => (
      metadata.connectionId === connectionId
        ? { ...metadata, enabled, updatedAt: new Date().toISOString() }
        : metadata
    )),
  });
}

export async function deleteConnector(connectionId: string): Promise<void> {
  const state = await readConnectorState();
  const metadata = state.connections.find((item) => item.connectionId === connectionId) ?? null;
  if (!metadata) {
    return;
  }

  const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
  if (catalogEntry) {
    await Promise.all(
      catalogEntry.requiredFields.map((field) => deleteConnectorSecret(connectionId, field.id)),
    );
  }
  await writeConnectorState({
    connections: state.connections.filter((item) => item.connectionId !== connectionId),
    pendingDeletes: state.pendingDeletes,
  });

  if (!catalogEntry || !connectorSupportsCloudSecretSync(catalogEntry)) {
    return;
  }

  try {
    await deleteCloudMcpConnection(connectionId);
  } catch {
    const nextState = await readConnectorState();
    await writeConnectorState({
      ...nextState,
      pendingDeletes: [
        ...nextState.pendingDeletes.filter((item) => item.connectionId !== connectionId),
        {
          connectionId,
          catalogEntryId: metadata.catalogEntryId,
          deletedAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString(),
        },
      ],
    });
  }
}
