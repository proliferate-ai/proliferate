import { describe, expect, it } from "vitest";
import { buildConnectedPluginPresentation } from "@/lib/domain/plugins/plugin-package-view-model";
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
  });
});

function installedRecord(input: {
  enabled: boolean;
  broken: boolean;
}): InstalledConnectorRecord {
  return {
    metadata: {
      connectionId: "conn_context7",
      catalogEntryId: "context7",
      enabled: input.enabled,
      serverName: "context7",
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
