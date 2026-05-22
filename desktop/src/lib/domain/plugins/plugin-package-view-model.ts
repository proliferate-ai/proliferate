import type {
  ConfiguredCapabilityItemState,
  ConnectorCatalogEntry,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";
import type { ConnectorCardStatus } from "@/lib/domain/mcp/connector-catalog-view-model";

export type PluginComponentKind = "app" | "mcp" | "skill" | "requirement";

export interface PluginComponentRowModel {
  kind: PluginComponentKind;
  label: string;
  description: string;
  stateLabel: string;
  stateTone: "neutral" | "success" | "warning" | "muted";
  publicLabel?: string;
  publicTone?: "neutral" | "success" | "warning" | "muted";
}

export interface PluginSharedExposurePresentation {
  personalCloudLabel: string;
  sharedCloudLabel: string;
  sourceLabel: string;
  sharedCloudDescription: string;
  sharedCloudTone: "neutral" | "success" | "warning" | "muted";
  configuredItemCount: number;
  publicItemCount: number;
  isFullyPublic: boolean;
  hasPublicItems: boolean;
}

export interface PluginPackagePresentation {
  id: string;
  name: string;
  description: string;
  includesLabel: string;
  enabledScopesLabel: string;
  components: PluginComponentRowModel[];
}

export function buildConnectedPluginPresentation(
  record: InstalledConnectorRecord,
  status: ConnectorCardStatus,
): PluginPackagePresentation {
  const entry = record.catalogEntry;
  const components = buildPluginComponents(entry, {
    authState: connectedCredentialStateLabel(status),
    mcpState: record.metadata.enabled ? "Enabled" : "Off",
    skillState: record.metadata.enabled ? "Enabled" : "Off",
    record,
  });

  return {
    id: entry.id,
    name: entry.name,
    description: entry.oneLiner,
    includesLabel: summarizeComponents(components),
    enabledScopesLabel: record.metadata.enabled ? "New sessions" : "Disabled",
    components,
  };
}

export function buildPluginSharedExposurePresentation(
  record: InstalledConnectorRecord,
): PluginSharedExposurePresentation {
  const items = buildConfiguredCapabilityItems(record);
  const publicItems = items.filter(isConfiguredCapabilityPublic);
  const blockedItems = items.filter((item) =>
    item.publicToOrg && item.publicStatus !== "public"
  );
  const isFullyPublic = items.length > 0 && publicItems.length === items.length;
  const hasPublicItems = publicItems.length > 0;
  const sharedCloudTone: PluginSharedExposurePresentation["sharedCloudTone"] =
    blockedItems.length > 0
      ? "warning"
      : isFullyPublic
        ? "success"
        : hasPublicItems
          ? "warning"
          : "muted";
  const sharedCloudLabel = blockedItems.length > 0
    ? "Shared attention"
    : isFullyPublic
      ? "Shared public"
      : hasPublicItems
        ? `${publicItems.length}/${items.length} shared`
        : "Shared private";

  return {
    personalCloudLabel: record.metadata.enabled ? "Personal cloud on" : "Personal cloud off",
    sourceLabel: configuredSourceLabel(items),
    sharedCloudLabel,
    sharedCloudDescription: hasPublicItems || isFullyPublic
      ? "Public items can be used by team automations, Slack, and shared cloud work."
      : "Private items stay limited to personal cloud and local use.",
    sharedCloudTone,
    configuredItemCount: items.length,
    publicItemCount: publicItems.length,
    isFullyPublic,
    hasPublicItems,
  };
}

export function buildConfiguredCapabilityItems(
  record: InstalledConnectorRecord,
): ConfiguredCapabilityItemState[] {
  return [
    {
      kind: "mcp",
      id: record.metadata.connectionId,
      sourceId: record.metadata.catalogEntryId,
      sourceKind: "mcp_catalog",
      sourceVersion: String(record.metadata.catalogEntryVersion),
      label: record.metadata.serverName || record.catalogEntry.serverNameBase,
      enabled: record.metadata.enabled,
      ownerScope: record.metadata.ownerScope,
      ownerUserId: record.metadata.ownerUserId ?? null,
      organizationId: record.metadata.organizationId ?? null,
      publicToOrg: record.metadata.publicToOrg,
      publicOrganizationId: record.metadata.publicOrganizationId ?? null,
      publicStatus: record.metadata.publicStatus,
      createdAt: record.metadata.createdAt,
      updatedAt: record.metadata.publicUpdatedAt ?? record.metadata.updatedAt,
    },
    ...(record.metadata.configuredPlugin ? [record.metadata.configuredPlugin] : []),
    ...record.metadata.configuredSkills,
  ];
}

export function isConfiguredCapabilityPublic(
  item: ConfiguredCapabilityItemState,
): boolean {
  return item.publicToOrg && item.publicStatus === "public";
}

export function buildAvailablePluginPresentation(
  entry: ConnectorCatalogEntry,
): PluginPackagePresentation {
  const components = buildPluginComponents(entry, {
    authState: setupLabel(entry),
    mcpState: "After setup",
    skillState: "After setup",
  });

  return {
    id: entry.id,
    name: entry.name,
    description: entry.oneLiner,
    includesLabel: summarizeComponents(components),
    enabledScopesLabel: "Not installed",
    components,
  };
}

function buildPluginComponents(
  entry: ConnectorCatalogEntry,
  state: {
    authState: string;
    mcpState: string;
    skillState: string;
    record?: InstalledConnectorRecord;
  },
): PluginComponentRowModel[] {
  const configuredSkillItemsBySourceId = new Map(
    state.record?.metadata.configuredSkills.map((item) => [item.sourceId, item]) ?? [],
  );
  const mcpPublicLabel = state.record
    ? configuredItemPublicLabel(buildConfiguredCapabilityItems(state.record)[0])
    : undefined;
  const components: PluginComponentRowModel[] = [
    {
      kind: "app",
      label: `${entry.name} connection`,
      description: "Account, token, or local setup used by plugin capabilities.",
      stateLabel: state.authState,
      stateTone: credentialStateTone(state.authState),
    },
    {
      kind: "mcp",
      label: entry.serverNameBase,
      description: "MCP tools mounted into compatible sessions.",
      stateLabel: state.mcpState,
      stateTone: state.mcpState === "Enabled" ? "success" : "muted",
      publicLabel: mcpPublicLabel,
      publicTone: publicLabelTone(mcpPublicLabel),
    },
  ];

  for (const skill of entry.pluginPackage?.skills ?? []) {
    const configuredSkill = configuredSkillItemsBySourceId.get(skill.id);
    const skillStateLabel = configuredSkill
      ? configuredSkill.enabled ? state.skillState : "Off"
      : "Not configured";
    const publicLabel = configuredSkill
      ? configuredItemPublicLabel(configuredSkill)
      : undefined;
    components.push({
      kind: "skill",
      label: skill.displayName,
      description: skill.description || "Reviewed markdown instructions agents can activate when relevant.",
      stateLabel: skillStateLabel,
      stateTone: skillStateLabel === "Enabled" ? "success" : "muted",
      publicLabel,
      publicTone: publicLabelTone(publicLabel),
    });
  }

  components.push(
    {
      kind: "requirement",
      label: runtimeRequirementLabel(entry),
      description: "Target-side runtime requirement for this plugin.",
      stateLabel: entry.availability === "cloud_only" ? "Cloud" : "Target",
      stateTone: "neutral",
    },
  );

  return components;
}

function configuredItemPublicLabel(
  item: ConfiguredCapabilityItemState | undefined,
): string | undefined {
  if (!item) {
    return undefined;
  }
  if (!item.publicToOrg) {
    return "Private";
  }
  if (item.publicStatus === "public") {
    return "Public";
  }
  return item.publicStatus;
}

function publicLabelTone(
  publicLabel: string | undefined,
): PluginComponentRowModel["publicTone"] {
  if (!publicLabel) {
    return undefined;
  }
  if (publicLabel === "Public") {
    return "success";
  }
  if (publicLabel === "Private") {
    return "muted";
  }
  return "warning";
}

function configuredSourceLabel(
  items: readonly ConfiguredCapabilityItemState[],
): string {
  const ownerScopes = new Set(items.map((item) => item.ownerScope));
  if (ownerScopes.size === 1 && ownerScopes.has("organization")) {
    return "Org-owned";
  }
  if (ownerScopes.size === 1 && (ownerScopes.has("personal") || ownerScopes.has("user"))) {
    return "Personal source";
  }
  return "Mixed source";
}

function connectedCredentialStateLabel(status: ConnectorCardStatus): string {
  if (status.intent === "needs_reconnect" || status.intent === "needs_token") {
    return status.label;
  }
  return "Connected";
}

function credentialStateTone(
  stateLabel: string,
): PluginComponentRowModel["stateTone"] {
  if (stateLabel === "Connected") {
    return "success";
  }
  if (stateLabel.startsWith("Needs ")) {
    return "warning";
  }
  return "neutral";
}

function summarizeComponents(components: readonly PluginComponentRowModel[]): string {
  const counts = components.reduce<Record<PluginComponentKind, number>>((acc, component) => {
    acc[component.kind] += 1;
    return acc;
  }, {
    app: 0,
    mcp: 0,
    skill: 0,
    requirement: 0,
  });
  const skillLabel = counts.skill
    ? `${counts.skill} ${counts.skill === 1 ? "skill" : "skills"}`
    : null;
  const parts = [
    counts.app ? "App" : null,
    counts.mcp ? `${counts.mcp} MCP` : null,
    skillLabel ?? null,
  ].filter(Boolean);
  return parts.join(" + ");
}

function setupLabel(entry: ConnectorCatalogEntry): string {
  if (entry.setupKind === "local_oauth") {
    return "Needs local auth";
  }
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return "Needs OAuth";
  }
  if (
    entry.transport === "http"
    && (entry.authKind === "secret" || entry.requiredFields.length > 0)
  ) {
    return "Needs token";
  }
  return "No setup";
}

function runtimeRequirementLabel(entry: ConnectorCatalogEntry): string {
  if (entry.transport === "stdio") {
    return "Local process";
  }
  if (entry.availability === "cloud_only") {
    return "Cloud runtime";
  }
  return "HTTP runtime";
}
