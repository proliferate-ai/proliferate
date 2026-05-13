import type {
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
    authState: status.label,
    mcpState: record.metadata.enabled ? "Enabled" : "Off",
    skillState: record.metadata.enabled ? "Available" : "Off",
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
  },
): PluginComponentRowModel[] {
  const skillCount = entry.pluginPackage?.skills.length ?? 0;
  const components: PluginComponentRowModel[] = [
    {
      kind: "app",
      label: `${entry.name} connection`,
      description: "Account, token, or local setup used by plugin capabilities.",
      stateLabel: state.authState,
      stateTone: state.authState === "Connected" ? "success" : "neutral",
    },
    {
      kind: "mcp",
      label: entry.serverNameBase,
      description: "MCP tools mounted into compatible sessions.",
      stateLabel: state.mcpState,
      stateTone: state.mcpState === "Enabled" ? "success" : "muted",
    },
  ];

  if (skillCount > 0) {
    components.push({
      kind: "skill",
      label: `${skillCount} ${skillCount === 1 ? "skill" : "skills"}`,
      description: "Reviewed markdown instructions agents can activate when relevant.",
      stateLabel: state.skillState,
      stateTone: state.skillState === "Available" ? "success" : "muted",
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
  const skillLabel = components.find((component) => component.kind === "skill")?.label;
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
