import type {
  CloudMcpConnection,
  CloudPluginConfiguredItem,
  CloudSkillConfiguredItem,
} from "@proliferate/cloud-sdk";

import type {
  PluginCatalogEntryView,
  PluginConfiguredCapabilityView,
  PluginConnectionStatusTone,
  PluginInventoryItem,
  PluginSetupVariant,
  PluginSurfaceKind,
} from "./cloud-plugin-inventory-types";
import {
  getPluginSecretFields,
  pluginRequiresBrowserAuth,
  pluginSupportsSurface,
} from "./cloud-plugin-settings";

export function installedItem(input: {
  connection: CloudMcpConnection;
  entry: PluginCatalogEntryView;
  configuredPlugin: CloudPluginConfiguredItem | null;
  configuredSkills: readonly CloudSkillConfiguredItem[];
  surface: PluginSurfaceKind;
}): PluginInventoryItem {
  const status = installedStatus(input.connection, input.entry);
  const publicState = publicExposureState(
    configuredCapabilityItems(
      input.connection,
      input.entry,
      input.configuredPlugin,
      input.configuredSkills,
    ),
  );
  return {
    id: input.connection.connectionId,
    state: "installed",
    entry: input.entry,
    setupVariant: resolveSetupVariant(input.entry),
    connection: input.connection,
    configuredPlugin: input.configuredPlugin,
    configuredSkills: input.configuredSkills,
    enabled: input.connection.enabled,
    broken: input.connection.authStatus !== "ready",
    statusLabel: status.label,
    statusTone: status.tone,
    statusActionLabel: status.actionLabel,
    unavailableReason: unavailableReason(input.entry, input.surface),
    capabilitySummary: capabilitySummary(input.entry),
    includesLabel: includesLabel(input.entry),
    sharedLabel: publicState.label,
    sharedTone: publicState.tone,
    isFullyPublic: publicState.isFullyPublic,
    hasPublicItems: publicState.hasPublicItems,
  };
}

export function availableItem(
  entry: PluginCatalogEntryView,
  surface: PluginSurfaceKind,
): PluginInventoryItem {
  return {
    id: entry.id,
    state: "available",
    entry,
    setupVariant: resolveSetupVariant(entry),
    configuredPlugin: null,
    configuredSkills: [],
    enabled: false,
    broken: false,
    statusLabel: unavailableReason(entry, surface) ?? "Not installed",
    statusTone: unavailableReason(entry, surface) ? "warning" : "muted",
    statusActionLabel: null,
    unavailableReason: unavailableReason(entry, surface),
    capabilitySummary: capabilitySummary(entry),
    includesLabel: includesLabel(entry),
    sharedLabel: "Private",
    sharedTone: "muted",
    isFullyPublic: false,
    hasPublicItems: false,
  };
}

function resolveSetupVariant(entry: PluginCatalogEntryView): PluginSetupVariant {
  if (entry.setupKind === "local_oauth") {
    return "local_oauth";
  }
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return entry.settingsSchema.length > 0 ? "oauth_structured" : "oauth";
  }
  if (getPluginSecretFields(entry).length > 0) {
    return "api_key";
  }
  return "no_setup";
}

function installedStatus(
  connection: CloudMcpConnection,
  entry: PluginCatalogEntryView,
): {
  label: string;
  tone: PluginConnectionStatusTone;
  actionLabel: string | null;
} {
  const usesReconnect = pluginRequiresBrowserAuth(entry) || entry.setupKind === "local_oauth";
  if (connection.authStatus !== "ready" && usesReconnect) {
    return { label: "Needs reconnect", tone: "error", actionLabel: "Reconnect" };
  }
  if (connection.authStatus !== "ready") {
    return { label: "Needs token", tone: "error", actionLabel: "Add token" };
  }
  if (!connection.enabled) {
    return { label: "Off", tone: "muted", actionLabel: null };
  }
  return { label: "Connected", tone: "neutral", actionLabel: null };
}

function configuredCapabilityItems(
  connection: CloudMcpConnection,
  entry: PluginCatalogEntryView,
  configuredPlugin: CloudPluginConfiguredItem | null,
  configuredSkills: readonly CloudSkillConfiguredItem[],
): PluginConfiguredCapabilityView[] {
  return [
    {
      kind: "mcp",
      id: connection.connectionId,
      label: connection.serverName || entry.serverNameBase,
      enabled: connection.enabled,
      ownerScope: connection.ownerScope,
      publicToOrg: connection.publicToOrg,
      publicOrganizationId: connection.publicOrganizationId ?? null,
      publicStatus: connection.publicStatus,
    },
    ...(configuredPlugin
      ? [{
          kind: "plugin" as const,
          id: configuredPlugin.id,
          label: entry.pluginPackage?.displayName ?? entry.name,
          enabled: configuredPlugin.enabled,
          ownerScope: configuredPlugin.ownerScope,
          publicToOrg: configuredPlugin.publicToOrg,
          publicOrganizationId: configuredPlugin.publicOrganizationId ?? null,
          publicStatus: configuredPlugin.publicStatus,
        }]
      : []),
    ...configuredSkills.map((skill) => ({
      kind: "skill" as const,
      id: skill.id,
      label:
        entry.pluginPackage?.skills.find((candidate) => candidate.id === skill.skillId)
          ?.displayName ?? skill.skillId,
      enabled: skill.enabled,
      ownerScope: skill.ownerScope,
      publicToOrg: skill.publicToOrg,
      publicOrganizationId: skill.publicOrganizationId ?? null,
      publicStatus: skill.publicStatus,
    })),
  ];
}

function publicExposureState(items: readonly PluginConfiguredCapabilityView[]): {
  label: string;
  tone: PluginConnectionStatusTone;
  isFullyPublic: boolean;
  hasPublicItems: boolean;
} {
  const publicItems = items.filter(isConfiguredCapabilityPublic);
  const blocked = items.filter((item) =>
    item.ownerScope !== "organization"
    && item.publicToOrg
    && item.publicStatus !== "public"
  );
  const isFullyPublic = items.length > 0 && publicItems.length === items.length;
  const hasPublicItems = publicItems.length > 0;
  if (blocked.length > 0) {
    return {
      label: "Share pending",
      tone: "warning",
      isFullyPublic,
      hasPublicItems,
    };
  }
  if (isFullyPublic) {
    return {
      label: "Shared public",
      tone: "neutral",
      isFullyPublic,
      hasPublicItems,
    };
  }
  if (hasPublicItems) {
    return {
      label: `${publicItems.length}/${items.length} shared`,
      tone: "warning",
      isFullyPublic,
      hasPublicItems,
    };
  }
  return {
    label: "Private",
    tone: "muted",
    isFullyPublic,
    hasPublicItems,
  };
}

function isConfiguredCapabilityPublic(item: PluginConfiguredCapabilityView): boolean {
  return item.ownerScope === "organization" || (item.publicToOrg && item.publicStatus === "public");
}

function capabilitySummary(entry: PluginCatalogEntryView): string {
  const skillCount = entry.pluginPackage?.skills.length ?? 0;
  return [
    "MCP",
    skillCount > 0 ? `${skillCount} ${skillCount === 1 ? "skill" : "skills"}` : null,
    authSummary(entry),
  ].filter(Boolean).join(" · ");
}

function includesLabel(entry: PluginCatalogEntryView): string {
  const skillCount = entry.pluginPackage?.skills.length ?? 0;
  return [
    "App",
    "1 MCP",
    skillCount > 0 ? `${skillCount} ${skillCount === 1 ? "skill" : "skills"}` : null,
  ].filter(Boolean).join(" + ");
}

function authSummary(entry: PluginCatalogEntryView): string {
  if (entry.setupKind === "local_oauth") {
    return "local auth";
  }
  if (entry.transport === "stdio") {
    return "local";
  }
  if (entry.authKind === "oauth") {
    return "OAuth";
  }
  if (entry.authKind === "secret" || entry.requiredFields.length > 0) {
    return "API key";
  }
  return "no setup";
}

function unavailableReason(
  entry: PluginCatalogEntryView,
  surface: PluginSurfaceKind,
): string | null {
  if (pluginSupportsSurface(entry, surface)) {
    return null;
  }
  if (surface === "web" && entry.setupKind === "local_oauth") {
    return "Requires Desktop";
  }
  if (surface === "web" && entry.availability === "local_only") {
    return "Desktop only";
  }
  return null;
}

export function groupSkillsByPluginId(
  skills: readonly CloudSkillConfiguredItem[],
): Map<string, CloudSkillConfiguredItem[]> {
  const grouped = new Map<string, CloudSkillConfiguredItem[]>();
  for (const skill of skills) {
    if (!skill.pluginId) {
      continue;
    }
    const existing = grouped.get(skill.pluginId) ?? [];
    existing.push(skill);
    grouped.set(skill.pluginId, existing);
  }
  return grouped;
}

export function matchesInventoryQuery(
  item: PluginInventoryItem,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return (
    item.entry.name.toLowerCase().includes(normalizedQuery)
    || item.entry.oneLiner.toLowerCase().includes(normalizedQuery)
    || item.entry.description.toLowerCase().includes(normalizedQuery)
  );
}

export function normalizeQuery(query: string | undefined): string {
  return query?.trim().toLowerCase() ?? "";
}
