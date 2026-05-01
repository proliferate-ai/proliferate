import {
  isConnectorCatalogEntryAvailable,
  getConnectorSecretFields,
  isOAuthConnectorCatalogEntry,
} from "@/lib/domain/mcp/catalog";
import {
  validateOAuthConnectorSettings,
} from "@/lib/domain/mcp/oauth";
import {
  connectorSettingsToCloud as domainConnectorSettingsToCloud,
  normalizeConnectorSettings,
} from "@/lib/domain/mcp/settings-schema";
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
import {
  cancelGoogleWorkspaceMcpAuth,
  deleteGoogleWorkspaceMcpLocalData,
  getGoogleWorkspaceMcpCredentialStatus,
  LocalMcpOAuthError,
  reconcileGoogleWorkspaceMcpPendingSetups,
  startGoogleWorkspaceMcpAuth,
} from "@/platform/tauri/google-workspace-mcp";
import { openExternal } from "@/platform/tauri/shell";

export interface ConnectorPaneData {
  installed: InstalledConnectorRecord[];
  available: readonly ConnectorCatalogEntry[];
}

const pendingCloudOAuthFlows = new Map<string, string>();
const pendingLocalOAuthSetups = new Map<string, { cancelled: boolean }>();

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
  const installedBase = connectionsResponse.connections
    .map((connection) => cloudConnectionToInstalledRecord(connection, entriesById))
    .filter((record): record is InstalledConnectorRecord => record !== null);
  const installed = await augmentLocalOAuthInstalledStatus(installedBase);
  void reconcileGoogleWorkspaceMcpPendingSetups({
    gmailConnections: installed
      .filter((record) => record.catalogEntry.id === "gmail")
      .map((record) => ({
        connectionId: record.metadata.connectionId,
        userGoogleEmail: readUserGoogleEmail(record.metadata.settings) ?? "",
      }))
      .filter((item) => item.userGoogleEmail.length > 0),
  }).catch(() => undefined);
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
    setupKind: entry.setupKind ?? "none",
    serverNameBase: entry.serverNameBase,
    iconId: entry.iconId as ConnectorCatalogEntry["iconId"],
    displayUrl: entry.displayUrl ?? entry.url,
    oauthClientMode: entry.oauthClientMode ?? undefined,
    secretFields: (entry.secretFields ?? entry.requiredFields).map((field) => ({
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      helperText: field.helperText,
      getTokenInstructions: field.getTokenInstructions,
      prefixHint: field.prefixHint ?? undefined,
    })),
    requiredFields: (entry.requiredFields ?? []).map((field) => ({
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      helperText: field.helperText,
      getTokenInstructions: field.getTokenInstructions,
      prefixHint: field.prefixHint ?? undefined,
    })),
    settingsSchema: (entry.settingsSchema ?? []).map((field) => ({
      id: field.id,
      kind: field.kind,
      label: field.label,
      placeholder: field.placeholder ?? "",
      helperText: field.helperText ?? "",
      required: field.required,
      defaultValue: field.defaultValue ?? undefined,
      options: (field.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
      affectsUrl: field.affectsUrl,
    })),
    capabilities: entry.capabilities,
  };
  if (entry.transport === "stdio") {
    return {
      ...common,
      transport: "stdio",
      command: entry.command ?? "",
      args: (entry.args ?? []).map(cloudArgTemplateToLocal),
      env: (entry.env ?? []).map(cloudEnvTemplateToLocal),
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
  if (entry.authKind === "none") {
    return {
      ...common,
      transport: "http",
      authKind: "none",
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

function cloudArgTemplateToLocal(
  arg: NonNullable<CloudMcpCatalogEntry["args"]>[number],
): Extract<ConnectorCatalogEntry, { transport: "stdio" }>["args"][number] {
  const source = arg.source;
  switch (source.kind) {
    case "workspace_path":
      return { source: { kind: "workspace_path" } };
    case "secret":
      return { source: { kind: "secret", fieldId: source.fieldId } };
    case "setting":
      return { source: { kind: "setting", fieldId: source.fieldId } };
    case "static":
      return { source: { kind: "static", value: source.value } };
  }
  return assertNeverTemplateSource(source);
}

function cloudEnvTemplateToLocal(
  env: NonNullable<CloudMcpCatalogEntry["env"]>[number],
): Extract<ConnectorCatalogEntry, { transport: "stdio" }>["env"][number] {
  const source = env.source;
  switch (source.kind) {
    case "secret":
      return { name: env.name, source: { kind: "secret", fieldId: source.fieldId } };
    case "setting":
      return { name: env.name, source: { kind: "setting", fieldId: source.fieldId } };
    case "static":
      return { name: env.name, source: { kind: "static", value: source.value } };
  }
  return assertNeverTemplateSource(source);
}

function assertNeverTemplateSource(source: never): never {
  throw new Error(`Unsupported MCP template source: ${JSON.stringify(source)}`);
}

function cloudConnectionToInstalledRecord(
  connection: CloudMcpConnection,
  entriesById: Map<string, ConnectorCatalogEntry>,
): InstalledConnectorRecord | null {
  const catalogEntry = entriesById.get(connection.catalogEntryId)
    ?? unavailableInstalledCatalogEntry(connection);
  if (!catalogEntry) {
    return null;
  }
  const settings = sanitizeCloudConnectorSettings(catalogEntry, connection.settings);
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

async function augmentLocalOAuthInstalledStatus(
  records: InstalledConnectorRecord[],
): Promise<InstalledConnectorRecord[]> {
  return Promise.all(records.map(async (record) => {
    if (record.catalogEntry.setupKind !== "local_oauth") {
      return record;
    }
    const userGoogleEmail = readUserGoogleEmail(record.metadata.settings);
    if (!userGoogleEmail) {
      return { ...record, broken: true };
    }
    const status = await getGoogleWorkspaceMcpCredentialStatus({ userGoogleEmail })
      .catch(() => ({ status: "not_ready" as const, code: "credential_invalid" as const }));
    return {
      ...record,
      broken: record.broken || status.status !== "ready",
    };
  }));
}

function unavailableInstalledCatalogEntry(
  connection: CloudMcpConnection,
): ConnectorCatalogEntry | null {
  if (connection.catalogEntryId !== "gmail") {
    return null;
  }
  return {
    id: "gmail",
    name: "Gmail",
    oneLiner: "Local Gmail MCP setup is unavailable in this deployment.",
    description: "Gmail is installed on this desktop, but setup is currently disabled. You can remove local Gmail data and delete the connector.",
    docsUrl: "https://developers.google.com/workspace/gmail/api/auth/scopes",
    availability: "local_only",
    cloudSecretSync: false,
    setupKind: "local_oauth",
    serverNameBase: "gmail",
    iconId: "gmail",
    displayUrl: "",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [gmailEmailSettingField()],
    capabilities: ["Search and read Gmail messages locally"],
    transport: "stdio",
    command: "",
    args: [],
    env: [],
  };
}

function gmailEmailSettingField() {
  return {
    id: "userGoogleEmail",
    kind: "string" as const,
    label: "Google account email",
    placeholder: "name@example.com",
    helperText: "The Gmail account authorized on this desktop.",
    required: true,
    defaultValue: undefined,
    options: [],
    affectsUrl: false,
  };
}

function sanitizeCloudConnectorSettings(
  catalogEntry: ConnectorCatalogEntry,
  settings: Record<string, unknown>,
): ConnectorSettings | undefined {
  if (catalogEntry.settingsSchema.length === 0) {
    return undefined;
  }
  return normalizeConnectorSettings(catalogEntry, settings);
}

function readUserGoogleEmail(settings: ConnectorSettings | undefined): string | null {
  const value = settings?.userGoogleEmail;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

export async function installConnector(
  catalogEntryId: string,
  secretValues: Record<string, string>,
  settings?: ConnectorSettings,
): Promise<void> {
  const catalogEntry = await loadCloudCatalogEntry(catalogEntryId);
  if (!isConnectorCatalogEntryAvailable(catalogEntry)) {
    throw new Error(`${catalogEntry.name} isn't available yet.`);
  }
  if (isOAuthConnectorCatalogEntry(catalogEntry)) {
    throw new Error(`${catalogEntry.name} uses browser auth.`);
  }
  if (catalogEntry.setupKind === "local_oauth") {
    await installLocalOAuthConnector(catalogEntry, settings);
    return;
  }

  const normalizedSecrets = normalizeConnectorSecretValues(catalogEntry, secretValues);
  validateConnectorSecretValues(catalogEntry, normalizedSecrets);

  const connection = await createCloudMcpConnection({
    catalogEntryId: catalogEntry.id,
    settings: domainConnectorSettingsToCloud(catalogEntry, settings),
    enabled: true,
  });
  if (getConnectorSecretFields(catalogEntry).length > 0) {
    await putCloudMcpSecretAuth(connection.connectionId, {
      secretFields: normalizedSecrets,
    });
  }
}

async function installLocalOAuthConnector(
  catalogEntry: ConnectorCatalogEntry,
  _settings?: ConnectorSettings,
): Promise<void> {
  if (catalogEntry.id !== "gmail") {
    throw new LocalMcpOAuthError("process_failed");
  }
  const oauthClientId = staticEnvValue(catalogEntry, "GOOGLE_OAUTH_CLIENT_ID");
  const oauthClientSecret = staticEnvValue(catalogEntry, "GOOGLE_OAUTH_CLIENT_SECRET");
  if (!oauthClientId || !oauthClientSecret) {
    throw new LocalMcpOAuthError("process_failed");
  }
  const setupId = crypto.randomUUID();
  let userGoogleEmail: string | null = null;
  let createdConnectionId: string | null = null;
  pendingLocalOAuthSetups.set(setupId, { cancelled: false });
  try {
    const authResult = await startGoogleWorkspaceMcpAuth({
      setupId,
      oauthClientId,
      oauthClientSecret,
    });
    userGoogleEmail = authResult.userGoogleEmail;
    throwIfLocalOAuthCancelled(setupId);
    const normalizedSettings = normalizeConnectorSettings(catalogEntry, { userGoogleEmail });
    const connection = await createCloudMcpConnection({
      catalogEntryId: catalogEntry.id,
      settings: domainConnectorSettingsToCloud(catalogEntry, normalizedSettings),
      enabled: true,
    });
    createdConnectionId = connection.connectionId;
    throwIfLocalOAuthCancelled(setupId);
    await reconcileGoogleWorkspaceMcpPendingSetups({
      gmailConnections: [{ connectionId: connection.connectionId, userGoogleEmail }],
    }).catch(() => undefined);
    throwIfLocalOAuthCancelled(setupId);
  } catch (error) {
    if (createdConnectionId) {
      await deleteCloudMcpConnectionV2(createdConnectionId).catch(() => undefined);
    }
    if (userGoogleEmail) {
      await deleteGoogleWorkspaceMcpLocalData({ setupId, userGoogleEmail }).catch(() => undefined);
    }
    throw error;
  } finally {
    pendingLocalOAuthSetups.delete(setupId);
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
    settings: domainConnectorSettingsToCloud(catalogEntry, settings),
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

export async function cancelLocalOAuthConnectorConnect(): Promise<void> {
  const setupIds = [...pendingLocalOAuthSetups.keys()];
  for (const setupId of setupIds) {
    const pending = pendingLocalOAuthSetups.get(setupId);
    if (pending) {
      pending.cancelled = true;
    }
  }
  await Promise.all(
    setupIds.map((setupId) =>
      cancelGoogleWorkspaceMcpAuth({ setupId }).catch(() => undefined)
    ),
  );
}

function throwIfLocalOAuthCancelled(setupId: string): void {
  if (pendingLocalOAuthSetups.get(setupId)?.cancelled) {
    throw new LocalMcpOAuthError("cancelled");
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
  if (catalogEntry.setupKind === "local_oauth") {
    return reconnectLocalOAuthConnector(connection, catalogEntry);
  }
  if (!isOAuthConnectorCatalogEntry(catalogEntry)) {
    throw new Error("Connector doesn't use browser auth.");
  }
  const nextSettings = settings ?? sanitizeCloudConnectorSettings(catalogEntry, connection.settings);
  const settingsError = validateOAuthConnectorSettings(catalogEntry, nextSettings);
  if (settingsError) {
    throw new Error(settingsError);
  }
  if (nextSettings) {
    await patchCloudMcpConnection(connectionId, {
      settings: domainConnectorSettingsToCloud(catalogEntry, nextSettings),
    });
  }
  return runCloudOAuthFlow(connectionId);
}

async function reconnectLocalOAuthConnector(
  connection: CloudMcpConnection,
  catalogEntry: ConnectorCatalogEntry,
): Promise<ConnectOAuthConnectorResult> {
  if (catalogEntry.id !== "gmail") {
    throw new LocalMcpOAuthError("process_failed");
  }
  const settings = sanitizeCloudConnectorSettings(catalogEntry, connection.settings);
  const userGoogleEmail = readUserGoogleEmail(settings);
  if (!userGoogleEmail) {
    throw new LocalMcpOAuthError("credential_invalid");
  }
  const oauthClientId = staticEnvValue(catalogEntry, "GOOGLE_OAUTH_CLIENT_ID");
  const oauthClientSecret = staticEnvValue(catalogEntry, "GOOGLE_OAUTH_CLIENT_SECRET");
  if (!oauthClientId || !oauthClientSecret) {
    throw new LocalMcpOAuthError("process_failed");
  }
  const setupId = crypto.randomUUID();
  pendingLocalOAuthSetups.set(setupId, { cancelled: false });
  try {
    await startGoogleWorkspaceMcpAuth({
      setupId,
      userGoogleEmail,
      oauthClientId,
      oauthClientSecret,
    });
    throwIfLocalOAuthCancelled(setupId);
    await reconcileGoogleWorkspaceMcpPendingSetups({
      gmailConnections: [{
        connectionId: connection.connectionId,
        userGoogleEmail,
      }],
    }).catch(() => undefined);
    throwIfLocalOAuthCancelled(setupId);
    return { kind: "completed" };
  } finally {
    pendingLocalOAuthSetups.delete(setupId);
  }
}

export async function updateConnectorSecret(
  connectionId: string,
  secretValues: Record<string, string>,
  settings?: ConnectorSettings,
): Promise<void> {
  const connection = (await listCloudMcpConnections()).connections
    .find((item) => item.connectionId === connectionId);
  if (!connection) {
    throw new Error("Connector was not found.");
  }
  const catalogEntry = await loadCloudCatalogEntry(connection.catalogEntryId);
  const fields = getConnectorSecretFields(catalogEntry);
  if (fields.length === 0) {
    throw new Error(`${catalogEntry.name} doesn't store a token.`);
  }
  const normalizedSecrets = normalizeConnectorSecretValues(catalogEntry, secretValues);
  validateConnectorSecretValues(catalogEntry, normalizedSecrets);
  if (settings) {
    await patchCloudMcpConnection(connectionId, {
      settings: domainConnectorSettingsToCloud(catalogEntry, settings),
    });
  }
  await putCloudMcpSecretAuth(connectionId, {
    secretFields: normalizedSecrets,
  });
}

function normalizeConnectorSecretValues(
  catalogEntry: ConnectorCatalogEntry,
  values: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const field of getConnectorSecretFields(catalogEntry)) {
    normalized[field.id] = normalizeConnectorSecretValue(values[field.id] ?? "");
  }
  return normalized;
}

function validateConnectorSecretValues(
  catalogEntry: ConnectorCatalogEntry,
  values: Record<string, string>,
): void {
  for (const field of getConnectorSecretFields(catalogEntry)) {
    const validationError = validateConnectorSecretValue(values[field.id] ?? "");
    if (validationError) {
      throw new Error(`${field.label}: ${validationError}`);
    }
  }
}

export async function setConnectorEnabled(
  connectionId: string,
  enabled: boolean,
): Promise<void> {
  await patchCloudMcpConnection(connectionId, { enabled });
}

export async function deleteConnector(connectionId: string): Promise<void> {
  const connection = (await listCloudMcpConnections()).connections
    .find((item) => item.connectionId === connectionId);
  if (connection?.catalogEntryId === "gmail") {
    const userGoogleEmail = typeof connection.settings.userGoogleEmail === "string"
      ? connection.settings.userGoogleEmail.trim().toLowerCase()
      : "";
    if (userGoogleEmail) {
      const result = await deleteGoogleWorkspaceMcpLocalData({
        connectionId,
        userGoogleEmail,
      });
      if (result.status === "retryable_failure") {
        throw new LocalMcpOAuthError(result.code);
      }
    }
  }
  await deleteCloudMcpConnectionV2(connectionId);
}

function staticEnvValue(catalogEntry: ConnectorCatalogEntry, name: string): string | null {
  if (catalogEntry.transport !== "stdio") {
    return null;
  }
  const item = catalogEntry.env.find((candidate) => candidate.name === name);
  return item?.source.kind === "static" ? item.source.value : null;
}
