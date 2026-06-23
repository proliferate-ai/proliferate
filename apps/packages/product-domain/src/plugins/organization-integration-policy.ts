import type {
  CloudMcpCatalogResponse,
  CloudOrganizationIntegrationPolicyResponse,
} from "@proliferate/cloud-sdk";

import {
  catalogEntryView,
  isActiveCatalogEntry,
} from "./cloud-plugin-catalog";
import { normalizeQuery } from "./cloud-plugin-inventory-items";
import type { PluginCatalogEntryView } from "./cloud-plugin-inventory-types";

export type OrganizationIntegrationPolicyStatusFilter =
  | "all"
  | "disabled"
  | "enabled";

export interface OrganizationIntegrationPolicyItem {
  catalogEntryId: string;
  name: string;
  description: string;
  iconId: string;
  enabled: boolean;
  tags: readonly string[];
}

export interface BuildOrganizationIntegrationPolicyItemsInput {
  catalog: CloudMcpCatalogResponse;
  policy?: CloudOrganizationIntegrationPolicyResponse | null;
  query?: string;
  statusFilter?: OrganizationIntegrationPolicyStatusFilter;
}

export function buildOrganizationIntegrationPolicyItems({
  catalog,
  policy = null,
  query,
  statusFilter = "all",
}: BuildOrganizationIntegrationPolicyItemsInput): OrganizationIntegrationPolicyItem[] {
  const normalizedQuery = normalizeQuery(query);
  const packagesByCatalogEntryId = new Map(
    (catalog.pluginPackages ?? []).map((pluginPackage) => [
      pluginPackage.catalogEntryId,
      pluginPackage,
    ]),
  );

  return catalog.entries
    .map((entry) => catalogEntryView(entry, packagesByCatalogEntryId.get(entry.id)))
    .filter(isActiveCatalogEntry)
    .map((entry) => policyItem(entry, policy))
    .filter((item) => matchesStatusFilter(item, statusFilter))
    .filter((item) => matchesQuery(item, normalizedQuery));
}

export function organizationIntegrationPolicyEnabled(
  catalogEntryId: string,
  policy: CloudOrganizationIntegrationPolicyResponse | null | undefined,
): boolean {
  if (!policy) {
    return true;
  }
  return policy.entries.find((entry) =>
    entry.catalogEntryId === catalogEntryId
  )?.enabled ?? true;
}

function policyItem(
  entry: PluginCatalogEntryView,
  policy: CloudOrganizationIntegrationPolicyResponse | null,
): OrganizationIntegrationPolicyItem {
  return {
    catalogEntryId: entry.id,
    name: entry.name,
    description: entry.oneLiner || entry.description,
    iconId: entry.iconId,
    enabled: organizationIntegrationPolicyEnabled(entry.id, policy),
    tags: integrationTags(entry),
  };
}

function integrationTags(entry: PluginCatalogEntryView): string[] {
  return [
    authTag(entry),
    entry.availability === "local_only" ? "Desktop only" : null,
    "MCP",
  ].filter((tag): tag is string => Boolean(tag));
}

function authTag(entry: PluginCatalogEntryView): string {
  if (entry.setupKind === "local_oauth") {
    return "Local auth";
  }
  if (entry.authKind === "oauth") {
    return "OAuth";
  }
  if (entry.authKind === "secret" || entry.requiredFields.length > 0) {
    return "API key";
  }
  return "No setup";
}

function matchesStatusFilter(
  item: OrganizationIntegrationPolicyItem,
  statusFilter: OrganizationIntegrationPolicyStatusFilter,
): boolean {
  if (statusFilter === "enabled") {
    return item.enabled;
  }
  if (statusFilter === "disabled") {
    return !item.enabled;
  }
  return true;
}

function matchesQuery(
  item: OrganizationIntegrationPolicyItem,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return (
    item.name.toLowerCase().includes(normalizedQuery)
    || item.description.toLowerCase().includes(normalizedQuery)
    || item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
  );
}
