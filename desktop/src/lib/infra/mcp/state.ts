import {
  ACTIVE_CONNECTOR_CATALOG,
  connectorHasMissingSecrets,
  getConnectorCatalogEntry,
  isConnectorCatalogEntryActive,
  isOAuthConnectorCatalogEntry,
} from "@/lib/domain/mcp/catalog";
import { validateOAuthConnectorSettings } from "@/lib/domain/mcp/oauth";
import { normalizeConnectorSecretValue } from "@/lib/domain/mcp/validation";
import type {
  ConnectorCatalogEntry,
  ConnectorDeleteTombstone,
  ConnectorSettings,
  ConnectorSyncState,
  InstalledConnectorRecord,
  PersistedConnectorState,
  SavedConnectorMetadata,
} from "@/lib/domain/mcp/types";
import { readPersistedValue, persistValue } from "@/lib/infra/preferences-persistence";
import { getConnectorSecret } from "@/platform/tauri/connectors";
import { getOAuthConnectorBundleState } from "@/platform/tauri/mcp-oauth";

const CONNECTORS_PERSISTENCE_KEY = "mcp_connections_v1";

const EMPTY_CONNECTOR_STATE: PersistedConnectorState = {
  connections: [],
  pendingDeletes: [],
};
let connectorStateMutationQueue: Promise<void> = Promise.resolve();

function isConnectorSyncState(value: unknown): value is ConnectorSyncState {
  return value === "synced" || value === "degraded";
}

function sanitizeConnectorMetadata(value: unknown): SavedConnectorMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<SavedConnectorMetadata>;
  if (
    typeof candidate.connectionId !== "string"
    || typeof candidate.catalogEntryId !== "string"
    || typeof candidate.enabled !== "boolean"
    || typeof candidate.serverName !== "string"
    || !isConnectorSyncState(candidate.syncState)
    || typeof candidate.createdAt !== "string"
    || typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    connectionId: candidate.connectionId,
    catalogEntryId: candidate.catalogEntryId as SavedConnectorMetadata["catalogEntryId"],
    enabled: candidate.enabled,
    serverName: candidate.serverName,
    syncState: candidate.syncState,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    lastSyncedAt:
      typeof candidate.lastSyncedAt === "string" || candidate.lastSyncedAt === null
        ? candidate.lastSyncedAt
        : null,
    settings: sanitizeConnectorSettings(candidate.settings),
  };
}

function sanitizeConnectorSettings(value: unknown): ConnectorSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<ConnectorSettings>;
  if (
    candidate.kind === "supabase"
    && typeof candidate.projectRef === "string"
    && typeof candidate.readOnly === "boolean"
  ) {
    return {
      kind: "supabase",
      projectRef: candidate.projectRef,
      readOnly: candidate.readOnly,
    };
  }
  return undefined;
}

function sanitizeDeleteTombstone(value: unknown): ConnectorDeleteTombstone | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ConnectorDeleteTombstone>;
  if (
    typeof candidate.connectionId !== "string"
    || typeof candidate.catalogEntryId !== "string"
    || typeof candidate.deletedAt !== "string"
  ) {
    return null;
  }
  return {
    connectionId: candidate.connectionId,
    catalogEntryId: candidate.catalogEntryId as ConnectorDeleteTombstone["catalogEntryId"],
    deletedAt: candidate.deletedAt,
    lastAttemptAt:
      typeof candidate.lastAttemptAt === "string" || candidate.lastAttemptAt === null
        ? candidate.lastAttemptAt
        : null,
  };
}

export async function readConnectorState(): Promise<PersistedConnectorState> {
  const persisted = await readPersistedValue<PersistedConnectorState>(CONNECTORS_PERSISTENCE_KEY);
  if (!persisted) {
    return EMPTY_CONNECTOR_STATE;
  }
  return {
    connections: Array.isArray(persisted.connections)
      ? persisted.connections
        .map((item) => sanitizeConnectorMetadata(item))
        .filter((item): item is SavedConnectorMetadata => item !== null)
      : [],
    pendingDeletes: Array.isArray(persisted.pendingDeletes)
      ? persisted.pendingDeletes
        .map((item) => sanitizeDeleteTombstone(item))
        .filter((item): item is ConnectorDeleteTombstone => item !== null)
      : [],
  };
}

export async function writeConnectorState(state: PersistedConnectorState): Promise<void> {
  await persistValue(CONNECTORS_PERSISTENCE_KEY, state);
}

export async function mutateConnectorState<T>(
  mutate: (
    state: PersistedConnectorState,
  ) => Promise<{ state: PersistedConnectorState; result: T }> | {
    state: PersistedConnectorState;
    result: T;
  },
): Promise<T> {
  const operation = connectorStateMutationQueue
    .catch(() => undefined)
    .then(async () => {
      const state = await readConnectorState();
      const next = await mutate(state);
      await writeConnectorState(next.state);
      return next.result;
    });

  connectorStateMutationQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

export function sortInstalledConnectors(connections: SavedConnectorMetadata[]) {
  return [...connections].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function loadConnectorSecretValue(
  connectionId: string,
  fieldId: string,
): Promise<string | null> {
  const value = await getConnectorSecret(connectionId, fieldId);
  const normalized = normalizeConnectorSecretValue(value ?? "");
  return normalized || null;
}

export async function loadConnectorSecretValues(
  connectionId: string,
  catalogEntry: ConnectorCatalogEntry,
): Promise<Record<string, string>> {
  const secretValues: Record<string, string> = {};
  for (const field of catalogEntry.requiredFields) {
    const value = await loadConnectorSecretValue(connectionId, field.id);
    if (value) {
      secretValues[field.id] = value;
    }
  }
  return secretValues;
}

export interface InstalledConnectorLaunchRecord {
  record: InstalledConnectorRecord;
  secretValues: Record<string, string>;
}
export async function updateConnectorSyncState(
  connectionId: string,
  syncState: ConnectorSyncState,
  lastSyncedAt: string | null,
): Promise<void> {
  await mutateConnectorState((state) => ({
    state: {
      ...state,
      connections: state.connections.map((metadata) => (
        metadata.connectionId === connectionId
          ? {
              ...metadata,
              syncState,
              lastSyncedAt,
              updatedAt: new Date().toISOString(),
            }
          : metadata
      )),
    },
    result: undefined,
  }));
}

export async function listInstalledConnectorRecords(): Promise<InstalledConnectorRecord[]> {
  const state = await readConnectorState();
  const installed: InstalledConnectorRecord[] = [];
  for (const metadata of sortInstalledConnectors(state.connections)) {
    const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
    if (!catalogEntry || !isConnectorCatalogEntryActive(catalogEntry)) {
      continue;
    }
    const secretValues = await loadConnectorSecretValues(metadata.connectionId, catalogEntry);
    const broken = isOAuthConnectorCatalogEntry(catalogEntry)
      ? (
          validateOAuthConnectorSettings(catalogEntry, metadata.settings) !== null
          || !(await getOAuthConnectorBundleState(metadata.connectionId)).hasBundle
        )
      : connectorHasMissingSecrets(catalogEntry, secretValues);
    installed.push({
      metadata,
      catalogEntry,
      broken,
    });
  }
  return installed;
}

export async function listInstalledConnectorLaunchRecords(): Promise<InstalledConnectorLaunchRecord[]> {
  const state = await readConnectorState();
  const installed: InstalledConnectorLaunchRecord[] = [];
  for (const metadata of sortInstalledConnectors(state.connections)) {
    const catalogEntry = getConnectorCatalogEntry(metadata.catalogEntryId);
    if (!catalogEntry || !isConnectorCatalogEntryActive(catalogEntry)) {
      continue;
    }
    const secretValues = await loadConnectorSecretValues(metadata.connectionId, catalogEntry);
    const broken = isOAuthConnectorCatalogEntry(catalogEntry)
      ? (
          validateOAuthConnectorSettings(catalogEntry, metadata.settings) !== null
          || !(await getOAuthConnectorBundleState(metadata.connectionId)).hasBundle
        )
      : connectorHasMissingSecrets(catalogEntry, secretValues);
    installed.push({
      record: {
        metadata,
        catalogEntry,
        broken,
      },
      secretValues,
    });
  }
  return installed;
}

export async function listAvailableConnectorEntries() {
  const state = await readConnectorState();
  const installedCatalogIds = new Set(state.connections.map((item) => item.catalogEntryId));
  return ACTIVE_CONNECTOR_CATALOG.filter((entry) => !installedCatalogIds.has(entry.id));
}
