import {
  isConnectorCatalogEntryAvailable,
} from "@/lib/domain/mcp/catalog";
import type {
  ConfiguredCapabilityItemState,
  ConnectorCatalogEntry,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";
import type {
  CloudMcpCatalogEntry,
  CloudMcpConnection,
  CloudPluginConfiguredItem,
  CloudSkillConfiguredItem,
} from "@/lib/access/cloud/client";
import type { PluginPackageCatalogEntry } from "@/lib/domain/plugins/types";
import { cloudPluginPackageToLocal } from "@/lib/domain/plugins/cloud-plugin-package";
import {
  getCloudMcpCatalog,
} from "@proliferate/cloud-sdk/client/mcp_catalog";
import {
  listCloudMcpConnections,
} from "@proliferate/cloud-sdk/client/mcp_connections";
import {
  listConfiguredPlugins,
} from "@proliferate/cloud-sdk/client/plugins";
import {
  listConfiguredSkills,
} from "@proliferate/cloud-sdk/client/skills";
import {
  augmentLocalOAuthInstalledStatus,
  reconcileLocalOAuthPendingSetups,
  sanitizeCloudConnectorSettings,
  unavailableInstalledCatalogEntry,
} from "./local-oauth-persistence";

export interface ConnectorPaneData {
  installed: InstalledConnectorRecord[];
  available: readonly ConnectorCatalogEntry[];
}

export async function loadCloudConnectorPaneData(): Promise<ConnectorPaneData> {
  const [catalog, connectionsResponse, pluginsResponse, skillsResponse] = await Promise.all([
    getCloudMcpCatalog(),
    listCloudMcpConnections(),
    listConfiguredPlugins(),
    listConfiguredSkills(),
  ]);
  const packagesByCatalogEntryId = new Map(
    (catalog.pluginPackages ?? []).map((pluginPackage) => [
      pluginPackage.catalogEntryId,
      cloudPluginPackageToLocal(pluginPackage),
    ]),
  );
  const entries = catalog.entries
    .map((entry) => cloudCatalogEntryToLocal(
      entry,
      packagesByCatalogEntryId.get(entry.id),
    ))
    .filter(isConnectorCatalogEntryAvailable);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const pluginItemsByPluginId = new Map(
    pluginsResponse.plugins.map((item) => [item.pluginId, item]),
  );
  const skillItemsByPluginId = groupSkillItemsByPluginId(skillsResponse.skills);
  const installedBase = connectionsResponse.connections
    .map((connection) =>
      cloudConnectionToInstalledRecord(
        connection,
        entriesById,
        pluginItemsByPluginId,
        skillItemsByPluginId,
      ))
    .filter((record): record is InstalledConnectorRecord => record !== null);
  const installed = await augmentLocalOAuthInstalledStatus(installedBase);
  void reconcileLocalOAuthPendingSetups(installed);
  const installedEntryIds = new Set(installed.map((record) => record.catalogEntry.id));
  return {
    installed,
    available: entries.filter((entry) => !installedEntryIds.has(entry.id)),
  };
}

export async function loadCloudCatalogEntry(catalogEntryId: string): Promise<ConnectorCatalogEntry> {
  const catalog = await getCloudMcpCatalog();
  const packagesByCatalogEntryId = new Map(
    (catalog.pluginPackages ?? []).map((pluginPackage) => [
      pluginPackage.catalogEntryId,
      cloudPluginPackageToLocal(pluginPackage),
    ]),
  );
  const entry = catalog.entries
    .map((candidate) => cloudCatalogEntryToLocal(
      candidate,
      packagesByCatalogEntryId.get(candidate.id),
    ))
    .find((candidate) => candidate.id === catalogEntryId);
  if (!entry) {
    throw new Error("Connector catalog entry was not found.");
  }
  return entry;
}

function cloudCatalogEntryToLocal(
  entry: CloudMcpCatalogEntry,
  pluginPackage?: PluginPackageCatalogEntry,
): ConnectorCatalogEntry {
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
    pluginPackage,
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
  pluginItemsByPluginId: Map<string, CloudPluginConfiguredItem>,
  skillItemsByPluginId: Map<string, CloudSkillConfiguredItem[]>,
): InstalledConnectorRecord | null {
  const catalogEntry = entriesById.get(connection.catalogEntryId)
    ?? unavailableInstalledCatalogEntry(connection);
  if (!catalogEntry) {
    return null;
  }
  const settings = sanitizeCloudConnectorSettings(catalogEntry, connection.settings);
  const pluginPackage = catalogEntry.pluginPackage;
  const configuredPlugin = pluginPackage
    ? pluginItemToConfiguredState(
        pluginItemsByPluginId.get(pluginPackage.id),
        pluginPackage.displayName || catalogEntry.name,
      )
    : null;
  const configuredSkills = pluginPackage
    ? (skillItemsByPluginId.get(pluginPackage.id) ?? []).map((item) =>
        skillItemToConfiguredState(
          item,
          pluginPackage.skills.find((skill) => skill.id === item.skillId)?.displayName
            ?? item.skillId,
        ))
    : [];
  return {
    catalogEntry,
    broken: connection.authStatus !== "ready",
    metadata: {
      connectionId: connection.connectionId,
      catalogEntryId: catalogEntry.id,
      catalogEntryVersion: connection.catalogEntryVersion,
      ownerScope: connection.ownerScope ?? "personal",
      ownerUserId: connection.ownerUserId ?? null,
      organizationId: connection.organizationId ?? null,
      enabled: connection.enabled,
      serverName: connection.serverName,
      publicToOrg: connection.publicToOrg ?? false,
      publicOrganizationId: connection.publicOrganizationId ?? null,
      publicStatus: connection.publicStatus ?? "private",
      publicUpdatedAt: connection.publicUpdatedAt ?? null,
      publicUpdatedByUserId: connection.publicUpdatedByUserId ?? null,
      configuredPlugin,
      configuredSkills,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      lastSyncedAt: connection.updatedAt,
      settings,
    },
  };
}

function groupSkillItemsByPluginId(
  skills: readonly CloudSkillConfiguredItem[],
): Map<string, CloudSkillConfiguredItem[]> {
  const grouped = new Map<string, CloudSkillConfiguredItem[]>();
  for (const item of skills) {
    if (!item.pluginId) {
      continue;
    }
    const existing = grouped.get(item.pluginId) ?? [];
    existing.push(item);
    grouped.set(item.pluginId, existing);
  }
  return grouped;
}

function pluginItemToConfiguredState(
  item: CloudPluginConfiguredItem | undefined,
  label: string,
): ConfiguredCapabilityItemState | null {
  if (!item) {
    return null;
  }
  return {
    kind: "plugin",
    id: item.id,
    sourceId: item.pluginId,
    sourceKind: "plugin",
    sourceVersion: item.pluginVersion ?? null,
    label,
    enabled: item.enabled,
    ownerScope: item.ownerScope,
    ownerUserId: item.ownerUserId ?? null,
    organizationId: item.organizationId ?? null,
    publicToOrg: item.publicToOrg,
    publicOrganizationId: item.publicOrganizationId ?? null,
    publicStatus: item.publicStatus,
    configVersion: item.configVersion,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function skillItemToConfiguredState(
  item: CloudSkillConfiguredItem,
  label: string,
): ConfiguredCapabilityItemState {
  return {
    kind: "skill",
    id: item.id,
    sourceId: item.skillId,
    sourceKind: item.skillSourceKind,
    sourceVersion: item.skillVersion ?? null,
    sourcePluginId: item.pluginId,
    sourcePluginVersion: item.pluginVersion ?? null,
    label,
    enabled: item.enabled,
    ownerScope: item.ownerScope,
    ownerUserId: item.ownerUserId ?? null,
    organizationId: item.organizationId ?? null,
    publicToOrg: item.publicToOrg,
    publicOrganizationId: item.publicOrganizationId ?? null,
    publicStatus: item.publicStatus,
    configVersion: item.configVersion,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
