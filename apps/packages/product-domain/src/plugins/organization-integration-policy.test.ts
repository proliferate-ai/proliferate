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
        tags: ["OAuth", "MCP"],
      }),
    ]);
  });

  it("applies policy and filters disabled entries", () => {
    const items = buildOrganizationIntegrationPolicyItems({
      catalog: catalog([
        entry({ id: "github", name: "GitHub" }),
        entry({ id: "linear", name: "Linear" }),
      ]),
      policy: policy([{ catalogEntryId: "linear", enabled: false }]),
      statusFilter: "disabled",
    });

    expect(items.map((item) => item.catalogEntryId)).toEqual(["linear"]);
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
      query: "api key",
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
