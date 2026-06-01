import {
  isConnectorCatalogEntryAvailable,
  getConnectorSecretFields,
  isOAuthConnectorCatalogEntry,
} from "@/lib/domain/mcp/catalog";
import {
  validateOAuthConnectorSettings,
} from "@/lib/domain/mcp/oauth";
import { connectorSettingsToCloud as domainConnectorSettingsToCloud } from "@/lib/domain/mcp/settings-schema";
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
  publicizeCloudMcpConnection,
  putCloudMcpSecretAuth,
  unpublicizeCloudMcpConnection,
} from "@proliferate/cloud-sdk/client/mcp_connections";
import {
  installConfiguredPlugin,
  patchConfiguredPlugin,
} from "@proliferate/cloud-sdk/client/plugins";
import {
  patchConfiguredSkill,
} from "@proliferate/cloud-sdk/client/skills";
import {
  deleteLocalOAuthConnectorDataBeforeCloudDelete,
  installLocalOAuthConnector,
  reconnectLocalOAuthConnector,
  sanitizeCloudConnectorSettings,
} from "./local-oauth-persistence";
import {
  loadCloudCatalogEntry,
} from "./connector-catalog-persistence";
import {
  runCloudOAuthFlow,
} from "./connector-oauth-flow";
import {
  normalizeConnectorSecretValues,
  validateConnectorSecretValues,
} from "./connector-secret-validation";

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
    await installPluginPackageIfPresent(catalogEntry);
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
  await installPluginPackageIfPresent(catalogEntry);
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
  } else {
    await installPluginPackageIfPresent(catalogEntry);
  }
  return result;
}

async function installPluginPackageIfPresent(
  catalogEntry: ConnectorCatalogEntry,
): Promise<void> {
  if (!catalogEntry.pluginPackage) {
    return;
  }
  await installConfiguredPlugin(catalogEntry.pluginPackage.id);
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

export async function setConnectorEnabled(
  connectionId: string,
  enabled: boolean,
): Promise<void> {
  await patchCloudMcpConnection(connectionId, { enabled });
}

export async function setConnectorPublicExposure(
  record: InstalledConnectorRecord,
  organizationId: string,
  publicToOrg: boolean,
): Promise<void> {
  if (record.metadata.ownerScope === "organization") {
    return;
  }
  const publicBody = publicToOrg
    ? { publicToOrg: true, publicOrganizationId: organizationId }
    : { publicToOrg: false, publicOrganizationId: null };
  const operations: Array<Promise<unknown>> = [
    publicToOrg
      ? publicizeCloudMcpConnection(record.metadata.connectionId, { organizationId })
      : unpublicizeCloudMcpConnection(record.metadata.connectionId),
  ];
  if (record.metadata.configuredPlugin) {
    operations.push(patchConfiguredPlugin(record.metadata.configuredPlugin.id, publicBody));
  }
  for (const skill of record.metadata.configuredSkills) {
    operations.push(patchConfiguredSkill(skill.id, publicBody));
  }
  await Promise.all(operations);
}

export async function deleteConnector(connectionId: string): Promise<void> {
  const connection = (await listCloudMcpConnections()).connections
    .find((item) => item.connectionId === connectionId);
  await deleteLocalOAuthConnectorDataBeforeCloudDelete(connection);
  await deleteCloudMcpConnectionV2(connectionId);
}
