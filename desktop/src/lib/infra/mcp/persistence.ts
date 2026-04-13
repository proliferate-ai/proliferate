import {
  isConnectorCatalogEntryAvailable,
  connectorSupportsCloudSecretSync,
  getConnectorCatalogEntry,
  getPrimarySecretField,
  isOAuthConnectorCatalogEntry,
} from "@/lib/domain/mcp/catalog";
import {
  buildOAuthConnectorServerUrl,
  validateOAuthConnectorSettings,
} from "@/lib/domain/mcp/oauth";
import { generateConnectorServerName } from "@/lib/domain/mcp/server-name";
import { normalizeConnectorSecretValue, validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  InstalledConnectorRecord,
  SavedConnectorMetadata,
} from "@/lib/domain/mcp/types";
import {
  listAvailableConnectorEntries,
  listInstalledConnectorRecords,
  loadConnectorSecretValue,
  mutateConnectorState,
  readConnectorState,
  updateConnectorSyncState,
} from "@/lib/infra/mcp/state";
import { syncConnectorReplica } from "@/lib/infra/mcp/sync";
import { deleteCloudMcpConnection } from "@/lib/integrations/cloud/mcp_connections";
import { deleteConnectorSecret, setConnectorSecret } from "@/platform/tauri/connectors";
import {
  connectOAuthConnector as runOAuthConnectorFlow,
  cancelOAuthConnectorConnect as cancelNativeOAuthConnectorConnect,
  type ConnectOAuthConnectorResult,
  deleteOAuthConnectorBundle,
} from "@/platform/tauri/mcp-oauth";

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
  // On macOS this usually means the app signature cannot read items created
  // by a previous build of the same binary — common for unsigned dev builds.
  const storedValue = await loadConnectorSecretValue(connectionId, fieldId);
  if (storedValue !== expectedValue) {
    throw new Error(
      `${connectorWriteFailureMessage(connectorName)} The macOS keychain did not return the token after writing it. On unsigned dev builds this can happen after a rebuild — delete this connector and re-add it.`,
    );
  }
}

function buildSavedConnectorMetadata(input: {
  catalogEntry: ConnectorCatalogEntry;
  connectionId: string;
  existingConnections: SavedConnectorMetadata[];
  settings?: ConnectorSettings;
}): SavedConnectorMetadata {
  const now = new Date().toISOString();
  return {
    connectionId: input.connectionId,
    catalogEntryId: input.catalogEntry.id,
    enabled: true,
    serverName: generateConnectorServerName(
      input.catalogEntry.serverNameBase,
      input.connectionId,
      input.existingConnections,
    ),
    syncState: connectorSupportsCloudSecretSync(input.catalogEntry) ? "degraded" : "synced",
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: connectorSupportsCloudSecretSync(input.catalogEntry) ? null : now,
    settings: input.settings,
  };
}

export async function installConnector(
  catalogEntryId: string,
  secretValue: string,
): Promise<{ degraded: boolean }> {
  const catalogEntry = getConnectorCatalogEntry(catalogEntryId);
  if (!catalogEntry) {
    throw new Error("Connector catalog entry was not found.");
  }
  if (!isConnectorCatalogEntryAvailable(catalogEntry)) {
    throw new Error(`${catalogEntry.name} isn't available yet.`);
  }
  if (isOAuthConnectorCatalogEntry(catalogEntry)) {
    throw new Error(`${catalogEntry.name} uses browser auth.`);
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

  let metadata: SavedConnectorMetadata;
  try {
    metadata = await mutateConnectorState((state) => {
      if (state.connections.some((item) => item.catalogEntryId === catalogEntry.id)) {
        throw new Error(`${catalogEntry.name} is already connected.`);
      }
      const nextMetadata = buildSavedConnectorMetadata({
        catalogEntry,
        connectionId,
        existingConnections: state.connections,
      });
      return {
        state: {
          ...state,
          connections: [...state.connections, nextMetadata],
        },
        result: nextMetadata,
      };
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

export async function connectOAuthConnector(
  catalogEntryId: string,
  settings?: ConnectorSettings,
  connectionId = crypto.randomUUID(),
): Promise<ConnectOAuthConnectorResult> {
  const catalogEntry = getConnectorCatalogEntry(catalogEntryId);
  if (!catalogEntry) {
    throw new Error("Connector catalog entry was not found.");
  }
  if (!isConnectorCatalogEntryAvailable(catalogEntry)) {
    throw new Error(`${catalogEntry.name} isn't available yet.`);
  }
  if (!isOAuthConnectorCatalogEntry(catalogEntry)) {
    throw new Error(`${catalogEntry.name} doesn't use browser auth.`);
  }

  const settingsError = validateOAuthConnectorSettings(catalogEntry, settings);
  if (settingsError) {
    throw new Error(settingsError);
  }

  const connectResult = await runOAuthConnectorFlow({
    connectionId,
    serverUrl: buildOAuthConnectorServerUrl(catalogEntry, settings),
  });
  if (connectResult.kind === "canceled") {
    return connectResult;
  }

  try {
    await mutateConnectorState((latestState) => {
      if (latestState.connections.some((item) => item.catalogEntryId === catalogEntry.id)) {
        throw new Error(`${catalogEntry.name} is already connected.`);
      }

      const metadata = buildSavedConnectorMetadata({
        catalogEntry,
        connectionId,
        existingConnections: latestState.connections,
        settings,
      });

      return {
        state: {
          ...latestState,
          connections: [...latestState.connections, metadata],
        },
        result: undefined,
      };
    });
  } catch (error) {
    await deleteOAuthConnectorBundle(connectionId).catch(() => undefined);
    throw error;
  }

  return connectResult;
}

export async function cancelOAuthConnectorConnect(connectionId: string): Promise<void> {
  await cancelNativeOAuthConnectorConnect(connectionId);
}

export async function reconnectOAuthConnector(
  connectionId: string,
  settings?: ConnectorSettings,
): Promise<ConnectOAuthConnectorResult> {
  const state = await readConnectorState();
  const metadata = state.connections.find((item) => item.connectionId === connectionId) ?? null;
  if (!metadata) {
    throw new Error("Connector was not found.");
  }
  const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
  if (!catalogEntry || !isOAuthConnectorCatalogEntry(catalogEntry)) {
    throw new Error("Connector doesn't use browser auth.");
  }

  const nextSettings = settings ?? metadata.settings;
  const settingsError = validateOAuthConnectorSettings(catalogEntry, nextSettings);
  if (settingsError) {
    throw new Error(settingsError);
  }

  const reconnectResult = await runOAuthConnectorFlow({
    connectionId: metadata.connectionId,
    serverUrl: buildOAuthConnectorServerUrl(catalogEntry, nextSettings),
  });
  if (reconnectResult.kind === "canceled") {
    return reconnectResult;
  }

  try {
    await mutateConnectorState((latestState) => {
      const latestMetadata = latestState.connections.find((item) => item.connectionId === connectionId) ?? null;
      if (!latestMetadata) {
        throw new Error("Connector was not found.");
      }
      if (latestMetadata.catalogEntryId !== catalogEntry.id) {
        throw new Error("Connector changed while reconnecting.");
      }
      return {
        state: {
          ...latestState,
          connections: latestState.connections.map((item) => (
            item.connectionId === connectionId
              ? {
                  ...item,
                  settings: nextSettings,
                  updatedAt: new Date().toISOString(),
                }
              : item
          )),
        },
        result: undefined,
      };
    });
  } catch (error) {
    await deleteOAuthConnectorBundle(connectionId).catch(() => undefined);
    throw error;
  }

  return reconnectResult;
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
  if (isOAuthConnectorCatalogEntry(catalogEntry)) {
    throw new Error(`${catalogEntry.name} uses browser auth.`);
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
  await mutateConnectorState((state) => ({
    state: {
      ...state,
      connections: state.connections.map((metadata) => (
        metadata.connectionId === connectionId
          ? { ...metadata, enabled, updatedAt: new Date().toISOString() }
          : metadata
      )),
    },
    result: undefined,
  }));
}

export async function deleteConnector(connectionId: string): Promise<void> {
  const state = await readConnectorState();
  const metadata = state.connections.find((item) => item.connectionId === connectionId) ?? null;
  if (!metadata) {
    return;
  }

  const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
  if (catalogEntry) {
    // Tolerate individual keychain failures so orphaned metadata can always be
    // cleaned up even when the underlying secret/OAuth bundle is missing or
    // ACL-denied (e.g. unsigned dev builds after a rebuild).
    await Promise.all(
      [
        ...catalogEntry.requiredFields.map(
          (field) => deleteConnectorSecret(connectionId, field.id).catch(() => undefined),
        ),
        ...(isOAuthConnectorCatalogEntry(catalogEntry)
          ? [deleteOAuthConnectorBundle(connectionId).catch(() => undefined)]
          : []),
      ],
    );
  }
  await mutateConnectorState((latestState) => ({
    state: {
      connections: latestState.connections.filter((item) => item.connectionId !== connectionId),
      pendingDeletes: latestState.pendingDeletes,
    },
    result: undefined,
  }));

  if (!catalogEntry || !connectorSupportsCloudSecretSync(catalogEntry)) {
    return;
  }

  try {
    await deleteCloudMcpConnection(connectionId);
  } catch {
    await mutateConnectorState((nextState) => ({
      state: {
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
      },
      result: undefined,
    }));
  }
}
