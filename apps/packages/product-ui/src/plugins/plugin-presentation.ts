
import type {
  PluginCatalogEntryView,
  PluginConnectionStatusTone,
  PluginInventoryItem,
  PluginSurfaceKind,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import type { BadgeTone } from "@proliferate/ui/primitives/Badge";
import type { PluginModalMode } from "./plugin-types";

export type PluginComponentTone = "neutral" | "success" | "warning" | "muted";

export interface PluginComponentRow {
  key: string;
  label: string;
  description: string;
  stateLabel: string;
  publicLabel?: string;
  publicTone?: PluginComponentTone;
}

export const PUBLIC_TONE_CLASSES: Record<PluginComponentTone, string> = {
  neutral: "border-border/50 text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  muted: "border-border/50 bg-muted/30 text-muted-foreground",
};

export function pluginComponentRows(item: PluginInventoryItem): PluginComponentRow[] {
  const skillItemsBySkillId = new Map(
    item.configuredSkills.map((skill) => [skill.skillId, skill]),
  );
  const rows: PluginComponentRow[] = [
    {
      key: "app",
      label: `${item.entry.name} connection`,
      description: "Account, token, or local setup used by plugin capabilities.",
      stateLabel: pluginConnectionStateLabel(item),
      ...publicChip(item.connection),
    },
    {
      key: "mcp",
      label: item.entry.serverNameBase,
      description: "MCP tools mounted into compatible sessions.",
      stateLabel: pluginCapabilityStateLabel(item, item.connection?.enabled),
      ...publicChip(item.connection),
    },
  ];

  for (const skill of item.entry.pluginPackage?.skills ?? []) {
    const configuredSkill = skillItemsBySkillId.get(skill.id);
    rows.push({
      key: `skill:${skill.id}`,
      label: skill.displayName,
      description: skill.description || "Reviewed markdown instructions agents can activate when relevant.",
      stateLabel: pluginCapabilityStateLabel(item, configuredSkill?.enabled),
      ...publicChip(configuredSkill),
    });
  }

  rows.push({
    key: "requirement",
    label: runtimeRequirementLabel(item.entry),
    description: "Target-side runtime requirement for this plugin.",
    stateLabel: item.entry.availability === "cloud_only" ? "Cloud" : "Target",
  });

  return rows;
}

function pluginConnectionStateLabel(item: PluginInventoryItem): string {
  if (item.state === "available") {
    return setupLabel(item.entry);
  }
  if (item.broken || item.statusActionLabel) {
    return item.statusLabel;
  }
  return "Connected";
}

function pluginCapabilityStateLabel(
  item: PluginInventoryItem,
  enabled: boolean | undefined,
): string {
  if (item.state === "available") {
    return "After setup";
  }
  if (enabled === false) {
    return "Off";
  }
  return "Enabled";
}

function publicChip(
  item: { ownerScope: string; publicToOrg: boolean; publicStatus: string } | null | undefined,
): Pick<PluginComponentRow, "publicLabel" | "publicTone"> {
  if (!item) {
    return {};
  }
  if (item.ownerScope === "organization" || (item.publicToOrg && item.publicStatus === "public")) {
    return { publicLabel: "Shared", publicTone: "success" };
  }
  if (item.publicToOrg) {
    return { publicLabel: "Sharing", publicTone: "warning" };
  }
  return {};
}

function setupLabel(entry: PluginCatalogEntryView): string {
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

function runtimeRequirementLabel(entry: PluginCatalogEntryView): string {
  if (entry.transport === "stdio") {
    return "Local process";
  }
  if (entry.availability === "cloud_only") {
    return "Cloud runtime";
  }
  return "HTTP runtime";
}

export function primaryActionLabel(
  item: PluginInventoryItem,
  mode: PluginModalMode,
  surface: PluginSurfaceKind,
): string | null {
  if (item.unavailableReason && mode === "connect" && surface === "web") {
    return "Open Desktop";
  }
  if (mode === "manage") {
    if (item.setupVariant === "no_setup") {
      return null;
    }
    if (item.setupVariant === "oauth" || item.setupVariant === "oauth_structured") {
      return "Reconnect";
    }
    return "Save";
  }
  if (item.setupVariant === "oauth" || item.setupVariant === "oauth_structured") {
    return "Connect in browser";
  }
  return "Install";
}

export function badgeTone(tone: PluginConnectionStatusTone): BadgeTone {
  switch (tone) {
    case "error":
      return "destructive";
    case "warning":
      return "warning";
    case "neutral":
      return "success";
    case "muted":
      return "neutral";
  }
}
