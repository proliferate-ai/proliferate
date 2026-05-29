import { describe, expect, it } from "vitest";
import {
  buildConnectedPluginPresentation,
  buildPluginSharedExposurePresentation,
} from "@/lib/domain/plugins/plugin-package-view-model";
import type { ConnectorCatalogEntry, InstalledConnectorRecord } from "@/lib/domain/mcp/types";

describe("buildConnectedPluginPresentation", () => {
  it("keeps disabled connected plugin credentials distinct from mounted state", () => {
    const presentation = buildConnectedPluginPresentation(
      installedRecord({ enabled: false, broken: false }),
      {
        intent: "off",
        label: "Off",
        actionable: false,
        tone: "muted",
      },
    );

    expect(presentation.components.find((row) => row.kind === "app")?.stateLabel)
      .toBe("Connected");
    expect(presentation.components.find((row) => row.kind === "mcp")?.stateLabel)
      .toBe("Off");
    expect(presentation.statusLabel).toBe("Off");
    expect(presentation.capabilitySummary).toBe("MCP · no setup");
  });

  it("shows broken credential state on the connection row", () => {
    const presentation = buildConnectedPluginPresentation(
      installedRecord({ enabled: true, broken: true }),
      {
        intent: "needs_token",
        label: "Needs token",
        actionable: true,
        tone: "error",
      },
    );

    expect(presentation.components.find((row) => row.kind === "app")?.stateLabel)
      .toBe("Needs token");
    expect(presentation.recoveryActionLabel).toBe("Add token");
  });

  it("keeps shared/public labels out of the plugin presentation", () => {
    const presentation = buildConnectedPluginPresentation(
      installedRecord({
        enabled: true,
        broken: false,
        publicToOrg: true,
        publicStatus: "public",
      }),
      {
        intent: "connected",
        label: "Connected",
        actionable: false,
        tone: "neutral",
      },
    );

    expect(presentation.components.some((row) => row.publicLabel)).toBe(false);
  });
});

describe("buildPluginSharedExposurePresentation", () => {
  it("treats org-owned configured items as shared by ownership", () => {
    const exposure = buildPluginSharedExposurePresentation(
      installedRecord({
        enabled: true,
        broken: false,
        ownerScope: "organization",
        publicToOrg: false,
        publicStatus: "private",
      }),
    );

    expect(exposure.isFullyPublic).toBe(true);
    expect(exposure.sharedCloudLabel).toBe("Shared public");
  });
});

function installedRecord(input: {
  enabled: boolean;
  broken: boolean;
  ownerScope?: "personal" | "organization";
  publicToOrg?: boolean;
  publicStatus?: "private" | "public";
}): InstalledConnectorRecord {
  return {
    metadata: {
      connectionId: "conn_context7",
      catalogEntryId: "context7",
      catalogEntryVersion: 1,
      ownerScope: input.ownerScope ?? "personal",
      ownerUserId: input.ownerScope === "organization" ? null : "user_1",
      organizationId: input.ownerScope === "organization" ? "org_1" : null,
      enabled: input.enabled,
      serverName: "context7",
      publicToOrg: input.publicToOrg ?? false,
      publicOrganizationId: input.publicToOrg ? "org_1" : null,
      publicStatus: input.publicStatus ?? "private",
      publicUpdatedAt: null,
      publicUpdatedByUserId: null,
      configuredPlugin: null,
      configuredSkills: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastSyncedAt: null,
    },
    catalogEntry: catalogEntry(),
    broken: input.broken,
  };
}

function catalogEntry(): ConnectorCatalogEntry {
  return {
    id: "context7",
    name: "Context7",
    oneLiner: "Fetch current library docs.",
    description: "Fetch current library docs.",
    docsUrl: "https://context7.example",
    availability: "universal",
    cloudSecretSync: false,
    setupKind: "none",
    serverNameBase: "context7",
    iconId: "context7",
    displayUrl: "context7.example",
    secretFields: [],
    requiredFields: [],
    settingsSchema: [],
    capabilities: ["Docs"],
    transport: "http",
    authKind: "none",
    url: "https://context7.example/mcp",
  };
}
