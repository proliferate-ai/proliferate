import { describe, expect, it } from "vitest";
import type {
  CloudMcpCatalogEntry,
  CloudMcpCatalogResponse,
  CloudOrganizationIntegrationPolicyResponse,
} from "@proliferate/cloud-sdk";

import {
  buildOrganizationIntegrationPolicyItems,
  organizationIntegrationPolicyEnabled,
} from "./organization-integration-policy";

describe("organization integration policy", () => {
  it("defaults catalog entries to enabled", () => {
    const items = buildOrganizationIntegrationPolicyItems({
      catalog: catalog([entry({ id: "github", name: "GitHub" })]),
      policy: null,
    });

    expect(items).toEqual([
      expect.objectContaining({
        catalogEntryId: "github",
        enabled: true,
        name: "GitHub",
        tags: ["Source control", "MCP"],
      }),
    ]);
  });

  it("applies policy and filters by category", () => {
    const items = buildOrganizationIntegrationPolicyItems({
      catalog: catalog([
        entry({ id: "github", name: "GitHub" }),
        entry({ id: "posthog", name: "PostHog", oneLiner: "Product analytics" }),
      ]),
      policy: policy([{ catalogEntryId: "posthog", enabled: false }]),
      categoryFilter: "observability",
    });

    expect(items.map((item) => item.catalogEntryId)).toEqual(["posthog"]);
    expect(items[0]?.enabled).toBe(false);
    expect(organizationIntegrationPolicyEnabled("github", policy([]))).toBe(true);
  });

  it("matches search against names, descriptions, and tags", () => {
    const items = buildOrganizationIntegrationPolicyItems({
      catalog: catalog([
        entry({ id: "github", name: "GitHub", oneLiner: "Source control" }),
        entry({
          id: "posthog",
          name: "PostHog",
          authKind: "secret",
          oneLiner: "Product analytics",
        }),
      ]),
      query: "observability",
    });

    expect(items.map((item) => item.catalogEntryId)).toEqual(["posthog"]);
  });
});

function catalog(entries: CloudMcpCatalogEntry[]): CloudMcpCatalogResponse {
  return {
    catalogVersion: "test",
    entries,
    pluginPackages: [],
  };
}

function policy(
  entries: Array<{ catalogEntryId: string; enabled: boolean }>,
): CloudOrganizationIntegrationPolicyResponse {
  return {
    organizationId: "org_1",
    entries: entries.map((entry) => ({
      ...entry,
      updatedAt: null,
      updatedByUserId: null,
    })),
  };
}

function entry(
  overrides: Partial<CloudMcpCatalogEntry> = {},
): CloudMcpCatalogEntry {
  return {
    id: "github",
    version: 1,
    name: "GitHub",
    oneLiner: "Work with issues and pull requests.",
    description: "GitHub tools.",
    docsUrl: "https://docs.example/github",
    availability: "universal",
    cloudSecretSync: true,
    setupKind: "none",
    transport: "http",
    authKind: "oauth",
    url: "https://github.example/mcp",
    displayUrl: "github.example",
    serverNameBase: "github",
    iconId: "github",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [],
    capabilities: ["issues"],
    ...overrides,
  };
}
