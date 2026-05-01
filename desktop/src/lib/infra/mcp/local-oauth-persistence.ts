import { normalizeConnectorSettings, connectorSettingsToCloud as domainConnectorSettingsToCloud } from "@/lib/domain/mcp/settings-schema";
import type { ConnectorCatalogEntry, ConnectorSettings, ConnectOAuthConnectorResult, InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { createCloudMcpConnection, deleteCloudMcpConnectionV2 } from "@/lib/integrations/cloud/mcp_connections";
import type { CloudMcpConnection } from "@/lib/integrations/cloud/client";
import {
  cancelGoogleWorkspaceMcpAuth,
  deleteGoogleWorkspaceMcpLocalData,
  getGoogleWorkspaceMcpCredentialStatus,
  LocalMcpOAuthError,
  reconcileGoogleWorkspaceMcpPendingSetups,
  startGoogleWorkspaceMcpAuth,
} from "@/platform/tauri/google-workspace-mcp";

const pendingLocalOAuthSetups = new Map<string, { cancelled: boolean }>();

export async function augmentLocalOAuthInstalledStatus(
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

export function unavailableInstalledCatalogEntry(
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

export function sanitizeCloudConnectorSettings(
  catalogEntry: ConnectorCatalogEntry,
  settings: Record<string, unknown>,
): ConnectorSettings | undefined {
  if (catalogEntry.settingsSchema.length === 0) {
    return undefined;
  }
  return normalizeConnectorSettings(catalogEntry, settings);
}

export function readUserGoogleEmail(settings: ConnectorSettings | undefined): string | null {
  const value = settings?.userGoogleEmail;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

export async function installLocalOAuthConnector(
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

export async function reconnectLocalOAuthConnector(
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

function staticEnvValue(catalogEntry: ConnectorCatalogEntry, name: string): string | null {
  if (catalogEntry.transport !== "stdio") {
    return null;
  }
  const item = catalogEntry.env.find((candidate) => candidate.name === name);
  return item?.source.kind === "static" ? item.source.value : null;
}

export function reconcileLocalOAuthPendingSetups(records: InstalledConnectorRecord[]): Promise<void> {
  return reconcileGoogleWorkspaceMcpPendingSetups({
    gmailConnections: records
      .filter((record) => record.catalogEntry.id === "gmail")
      .map((record) => ({
        connectionId: record.metadata.connectionId,
        userGoogleEmail: readUserGoogleEmail(record.metadata.settings) ?? "",
      }))
      .filter((item) => item.userGoogleEmail.length > 0),
  }).then(() => undefined).catch(() => undefined);
}

export async function deleteLocalOAuthConnectorDataBeforeCloudDelete(
  connection: CloudMcpConnection | undefined,
): Promise<void> {
  if (connection?.catalogEntryId !== "gmail") {
    return;
  }
  const userGoogleEmail = typeof connection.settings.userGoogleEmail === "string"
    ? connection.settings.userGoogleEmail.trim().toLowerCase()
    : "";
  if (!userGoogleEmail) {
    return;
  }
  const result = await deleteGoogleWorkspaceMcpLocalData({
    connectionId: connection.connectionId,
    userGoogleEmail,
  });
  if (result.status === "retryable_failure") {
    throw new LocalMcpOAuthError(result.code);
  }
}
