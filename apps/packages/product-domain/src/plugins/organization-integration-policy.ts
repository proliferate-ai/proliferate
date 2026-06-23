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

export type OrganizationIntegrationPolicyCategoryFilter =
  | "all"
  | "knowledge"
  | "mcp"
  | "observability"
  | "project_management"
  | "source_control";

export interface OrganizationIntegrationPolicyFilterOption {
  id: OrganizationIntegrationPolicyCategoryFilter;
  label: string;
}

export const ORGANIZATION_INTEGRATION_POLICY_FILTER_OPTIONS: readonly OrganizationIntegrationPolicyFilterOption[] = [
  { id: "all", label: "All" },
  { id: "source_control", label: "Source control" },
  { id: "project_management", label: "Project management" },
  { id: "observability", label: "Observability" },
  { id: "knowledge", label: "Knowledge" },
  { id: "mcp", label: "MCP" },
];

export interface OrganizationIntegrationPolicyItem {
  catalogEntryId: string;
  name: string;
  description: string;
  iconId: string;
  enabled: boolean;
  categories: readonly OrganizationIntegrationPolicyCategoryFilter[];
  tags: readonly string[];
}

export interface BuildOrganizationIntegrationPolicyItemsInput {
  catalog: CloudMcpCatalogResponse;
  policy?: CloudOrganizationIntegrationPolicyResponse | null;
  query?: string;
  categoryFilter?: OrganizationIntegrationPolicyCategoryFilter;
}

export function buildOrganizationIntegrationPolicyItems({
  catalog,
  policy = null,
  query,
  categoryFilter = "all",
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
    .filter((item) => matchesCategoryFilter(item, categoryFilter))
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
  const categories = integrationCategories(entry);
  return {
    catalogEntryId: entry.id,
    name: entry.name,
    description: entry.oneLiner || entry.description,
    iconId: entry.iconId,
    enabled: organizationIntegrationPolicyEnabled(entry.id, policy),
    categories,
    tags: integrationTags(categories),
  };
}

function integrationCategories(
  entry: PluginCatalogEntryView,
): OrganizationIntegrationPolicyCategoryFilter[] {
  const categories = new Set<OrganizationIntegrationPolicyCategoryFilter>(["mcp"]);
  switch (entry.id) {
    case "github":
    case "gitlab":
      categories.add("source_control");
      break;
    case "linear":
      categories.add("project_management");
      break;
    case "axiom":
    case "posthog":
    case "render":
    case "sentry":
      categories.add("observability");
      break;
    case "cloudflare_docs":
    case "context7":
    case "exa":
    case "gmail":
    case "notion":
    case "slack":
    case "tavily":
      categories.add("knowledge");
      break;
  }
  return [...categories];
}

function integrationTags(
  categories: readonly OrganizationIntegrationPolicyCategoryFilter[],
): string[] {
  const categoryLabels = new Map(
    ORGANIZATION_INTEGRATION_POLICY_FILTER_OPTIONS.map((option) => [option.id, option.label]),
  );
  const ordered = ORGANIZATION_INTEGRATION_POLICY_FILTER_OPTIONS
    .map((option) => option.id)
    .filter((category) => category !== "all" && categories.includes(category));
  return ordered.map((category) => categoryLabels.get(category) ?? category);
}

function matchesCategoryFilter(
  item: OrganizationIntegrationPolicyItem,
  categoryFilter: OrganizationIntegrationPolicyCategoryFilter,
): boolean {
  if (categoryFilter === "all") {
    return true;
  }
  return item.categories.includes(categoryFilter);
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
