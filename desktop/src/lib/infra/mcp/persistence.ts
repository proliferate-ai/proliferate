import {
  isConnectorCatalogEntryAvailable,
  getPrimarySecretField,
  isOAuthConnectorCatalogEntry,
} from "@/lib/domain/mcp/catalog";
import {
  validateOAuthConnectorSettings,
} from "@/lib/domain/mcp/oauth";
import { normalizeConnectorSecretValue, validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  ConnectOAuthConnectorResult,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";
import {
  createCloudMcpConnection,
  deleteCloudMcpConnectionV2,
  listCloudMcpConnections,
  patchCloudMcpConnection,
  putCloudMcpSecretAuth,
} from "@/lib/integrations/cloud/mcp_connections";
import {
  cancelCloudMcpOAuthFlow,
  getCloudMcpOAuthFlowStatus,
  startCloudMcpOAuthFlow,
} from "@/lib/integrations/cloud/mcp_oauth";
import { getCloudMcpCatalog } from "@/lib/integrations/cloud/mcp_catalog";
import type { CloudMcpCatalogEntry, CloudMcpConnection } from "@/lib/integrations/cloud/client";
import { openExternal } from "@/platform/tauri/shell";

export interface ConnectorPaneData {
  installed: InstalledConnectorRecord[];
  available: readonly ConnectorCatalogEntry[];
}

const pendingCloudOAuthFlows = new Map<string, string>();

export async function loadConnectorPaneData(): Promise<ConnectorPaneData> {
  return loadCloudConnectorPaneData();
}

async function loadCloudConnectorPaneData(): Promise<ConnectorPaneData> {
  const [catalog, connectionsResponse] = await Promise.all([
    getCloudMcpCatalog(),
    listCloudMcpConnections(),
  ]);
  const entries = catalog.entries
    .map(cloudCatalogEntryToLocal)
    .filter(isConnectorCatalogEntryAvailable);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const installed = connectionsResponse.connections
    .map((connection) => cloudConnectionToInstalledRecord(connection, entriesById))
    .filter((record): record is InstalledConnectorRecord => record !== null);
  const installedEntryIds = new Set(installed.map((record) => record.catalogEntry.id));
  return {
    installed,
    available: entries.filter((entry) => !installedEntryIds.has(entry.id)),
  };
}

async function loadCloudCatalogEntry(catalogEntryId: string): Promise<ConnectorCatalogEntry> {
  const catalog = await getCloudMcpCatalog();
  const entry = catalog.entries
    .map(cloudCatalogEntryToLocal)
    .find((candidate) => candidate.id === catalogEntryId);
  if (!entry) {
    throw new Error("Connector catalog entry was not found.");
  }
  return entry;
}

function cloudCatalogEntryToLocal(entry: CloudMcpCatalogEntry): ConnectorCatalogEntry {
  const common = {
    id: entry.id as ConnectorCatalogEntry["id"],
    name: entry.name,
    oneLiner: entry.oneLiner,
    description: entry.description,
    docsUrl: entry.docsUrl,
    availability: entry.availability,
    cloudSecretSync: entry.cloudSecretSync,
    serverNameBase: entry.serverNameBase,
    iconId: entry.iconId as ConnectorCatalogEntry["iconId"],
    requiredFields: entry.requiredFields.map((field) => ({
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      helperText: field.helperText,
      getTokenInstructions: field.getTokenInstructions,
      prefixHint: field.prefixHint ?? undefined,
    })),
    capabilities: entry.capabilities,
  };
  if (entry.transport === "stdio") {
    return {
      ...common,
      transport: "stdio",
      command: entry.command ?? "",
      args: (entry.args ?? []).map((arg) => (
        arg.source.kind === "workspace_path"
          ? { source: { kind: "workspace_path" } }
          : { source: { kind: "static", value: arg.source.value ?? "" } }
      )),
      env: (entry.env ?? []).map((env) => (
        env.source.kind === "field"
          ? { name: env.name, source: { kind: "field", fieldId: env.source.fieldId ?? "" } }
          : { name: env.name, source: { kind: "static", value: env.source.value ?? "" } }
      )),
    };
  }
  if (entry.authKind === "oauth") {
    return {
      ...common,
      transport: "http",
      authKind: "oauth",
      url: entry.url,
    };
  }
  return {
    ...common,
    transport: "http",
    authKind: "secret",
    authStyle: entry.authStyle?.kind === "header"
      ? { kind: "header", headerName: entry.authStyle.headerName ?? "" }
      : entry.authStyle?.kind === "query"
        ? { kind: "query", parameterName: entry.authStyle.parameterName ?? "" }
        : { kind: "bearer" },
    authFieldId: entry.authFieldId ?? "",
    url: entry.url,
  };
}

function cloudConnectionToInstalledRecord(
  connection: CloudMcpConnection,
  entriesById: Map<string, ConnectorCatalogEntry>,
): InstalledConnectorRecord | null {
  const catalogEntry = entriesById.get(connection.catalogEntryId);
  if (!catalogEntry) {
    return null;
  }
  const settings = sanitizeCloudConnectorSettings(connection.settings);
  return {
    catalogEntry,
    broken: connection.authStatus !== "ready",
    metadata: {
      connectionId: connection.connectionId,
      catalogEntryId: catalogEntry.id,
      enabled: connection.enabled,
      serverName: connection.serverName,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      lastSyncedAt: connection.updatedAt,
      settings,
    },
  };
}

function sanitizeCloudConnectorSettings(
  settings: Record<string, unknown>,
): ConnectorSettings | undefined {
  if (
    settings.kind === "supabase"
    && typeof settings.projectRef === "string"
    && typeof settings.readOnly === "boolean"
  ) {
    return {
      kind: "supabase",
      projectRef: settings.projectRef,
      readOnly: settings.readOnly,
    };
  }
  return undefined;
}

function connectorSettingsToCloud(
  settings: ConnectorSettings | undefined,
): Record<string, unknown> | undefined {
  if (!settings) {
    return undefined;
  }
  if (settings.kind === "supabase") {
    return {
      kind: "supabase",
      projectRef: settings.projectRef,
      readOnly: settings.readOnly,
    };
  }
  return undefined;
}

export async function installConnector(
  catalogEntryId: string,
  secretValue: string,
): Promise<void> {
  const catalogEntry = await loadCloudCatalogEntry(catalogEntryId);
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

  const connection = await createCloudMcpConnection({
    catalogEntryId: catalogEntry.id,
    enabled: true,
  });
  if (field) {
    await putCloudMcpSecretAuth(connection.connectionId, {
      secretFields: { [field.id]: normalizedSecret },
    });
  }
}

export async function connectOAuthConnector(
  catalogEntryId: string,
  settings?: ConnectorSettings,
  pendingAliasConnectionId?: string,
): Promise<ConnectOAuthConnectorResult> {
  const catalogEntry = await loadCloudCatalogEntry(catalogEntryId);
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

  const connection = await createCloudMcpConnection({
    catalogEntryId: catalogEntry.id,
    settings: connectorSettingsToCloud(settings),
    enabled: true,
  });
  const result = await runCloudOAuthFlow(connection.connectionId, pendingAliasConnectionId);
  if (result.kind === "canceled") {
    await deleteCloudMcpConnectionV2(connection.connectionId).catch(() => undefined);
  }
  return result;
}

export async function cancelOAuthConnectorConnect(connectionId: string): Promise<void> {
  const flowId = pendingCloudOAuthFlows.get(connectionId);
  if (flowId) {
    await cancelCloudMcpOAuthFlow(flowId);
    clearPendingCloudOAuthFlowByFlowId(flowId);
  }
}

async function runCloudOAuthFlow(
  connectionId: string,
  pendingAliasConnectionId?: string,
): Promise<ConnectOAuthConnectorResult> {
  const started = await startCloudMcpOAuthFlow(connectionId);
  pendingCloudOAuthFlows.set(connectionId, started.flowId);
  if (pendingAliasConnectionId) {
    pendingCloudOAuthFlows.set(pendingAliasConnectionId, started.flowId);
  }
  await openExternal(started.authorizationUrl);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await getCloudMcpOAuthFlowStatus(started.flowId);
    if (status.status === "completed") {
      clearPendingCloudOAuthFlow(connectionId);
      if (pendingAliasConnectionId) {
        clearPendingCloudOAuthFlow(pendingAliasConnectionId);
      }
      return { kind: "completed" };
    }
    if (status.status === "cancelled") {
      clearPendingCloudOAuthFlow(connectionId);
      if (pendingAliasConnectionId) {
        clearPendingCloudOAuthFlow(pendingAliasConnectionId);
      }
      return { kind: "canceled" };
    }
    if (status.status === "failed" || status.status === "expired") {
      clearPendingCloudOAuthFlow(connectionId);
      if (pendingAliasConnectionId) {
        clearPendingCloudOAuthFlow(pendingAliasConnectionId);
      }
      throw new Error("Couldn't complete OAuth for this connector.");
    }
  }
  await cancelCloudMcpOAuthFlow(started.flowId).catch(() => undefined);
  clearPendingCloudOAuthFlow(connectionId);
  if (pendingAliasConnectionId) {
    clearPendingCloudOAuthFlow(pendingAliasConnectionId);
  }
  throw new Error("OAuth authorization timed out.");
}

function clearPendingCloudOAuthFlow(connectionId: string): void {
  pendingCloudOAuthFlows.delete(connectionId);
}

function clearPendingCloudOAuthFlowByFlowId(flowId: string): void {
  for (const [connectionId, pendingFlowId] of pendingCloudOAuthFlows) {
    if (pendingFlowId === flowId) {
      pendingCloudOAuthFlows.delete(connectionId);
    }
  }
}

export async function reconnectOAuthConnector(
  connectionId: string,
  settings?: ConnectorSettings,
): Promise<ConnectOAuthConnectorResult> {
  const connection = (await listCloudMcpConnections()).connections
    .find((item) => item.connectionId === connectionId);
  if (!connection) {
    throw new Error("Connector was not found.");
  }
  const catalogEntry = await loadCloudCatalogEntry(connection.catalogEntryId);
  if (!isOAuthConnectorCatalogEntry(catalogEntry)) {
    throw new Error("Connector doesn't use browser auth.");
  }
  const nextSettings = settings ?? sanitizeCloudConnectorSettings(connection.settings);
  const settingsError = validateOAuthConnectorSettings(catalogEntry, nextSettings);
  if (settingsError) {
    throw new Error(settingsError);
  }
  if (nextSettings) {
    await patchCloudMcpConnection(connectionId, {
      settings: connectorSettingsToCloud(nextSettings),
    });
  }
  return runCloudOAuthFlow(connectionId);
}

export async function updateConnectorSecret(
  connectionId: string,
  secretValue: string,
): Promise<void> {
  const connection = (await listCloudMcpConnections()).connections
    .find((item) => item.connectionId === connectionId);
  if (!connection) {
    throw new Error("Connector was not found.");
  }
  const catalogEntry = await loadCloudCatalogEntry(connection.catalogEntryId);
  const field = getPrimarySecretField(catalogEntry);
  if (!field) {
    throw new Error(`${catalogEntry.name} doesn't store a token.`);
  }
  const normalizedSecret = normalizeConnectorSecretValue(secretValue);
  const validationError = validateConnectorSecretValue(normalizedSecret);
  if (validationError) {
    throw new Error(validationError);
  }
  await putCloudMcpSecretAuth(connectionId, {
    secretFields: { [field.id]: normalizedSecret },
  });
}

export async function setConnectorEnabled(
  connectionId: string,
  enabled: boolean,
): Promise<void> {
  await patchCloudMcpConnection(connectionId, { enabled });
}

export async function deleteConnector(connectionId: string): Promise<void> {
  await deleteCloudMcpConnectionV2(connectionId);
}
