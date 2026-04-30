import type { SessionMcpBindingSummary } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import type { ConnectorCatalogEntry, InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { shouldShowPowersNeedsRestart } from "./SessionPowersSummary";

const TEST_CATALOG: Record<string, ConnectorCatalogEntry> = {
  context7: {
    id: "context7",
    name: "Context7",
    oneLiner: "Docs",
    description: "Docs",
    docsUrl: "https://example.com",
    availability: "universal",
    cloudSecretSync: true,
    transport: "http",
    authKind: "secret",
    authStyle: { kind: "bearer" },
    authFieldId: "api_key",
    url: "https://mcp.example.com/mcp",
    serverNameBase: "context7",
    iconId: "context7",
    requiredFields: [],
    capabilities: [],
  },
  filesystem: {
    id: "filesystem",
    name: "Filesystem",
    oneLiner: "Files",
    description: "Files",
    docsUrl: "https://example.com",
    availability: "local_only",
    cloudSecretSync: false,
    transport: "stdio",
    command: "npx",
    args: [{ source: { kind: "workspace_path" } }],
    env: [],
    serverNameBase: "filesystem",
    iconId: "folder",
    requiredFields: [],
    capabilities: [],
  },
};

function installedConnector(
  connectionId: string,
  catalogEntryId: InstalledConnectorRecord["metadata"]["catalogEntryId"] = "context7",
): InstalledConnectorRecord {
  const catalogEntry = TEST_CATALOG[catalogEntryId];
  if (!catalogEntry) {
    throw new Error(`missing catalog entry ${catalogEntryId}`);
  }
  return {
    broken: false,
    catalogEntry,
    metadata: {
      catalogEntryId,
      connectionId,
      createdAt: "2026-04-19T00:00:00.000Z",
      enabled: true,
      lastSyncedAt: null,
      serverName: catalogEntry.serverNameBase,
      updatedAt: "2026-04-19T00:00:00.000Z",
    },
  };
}

function summary(input: Partial<SessionMcpBindingSummary> & {
  id: string;
}): SessionMcpBindingSummary {
  return {
    displayName: "Context7",
    outcome: "applied",
    serverName: "context7",
    transport: "http",
    ...input,
  };
}

describe("shouldShowPowersNeedsRestart", () => {
  it("does not show while connector data is still placeholder data", () => {
    expect(shouldShowPowersNeedsRestart({
      connectorDataReady: false,
      installed: [],
      summaries: [summary({ id: "connector-1" })],
    })).toBe(false);
  });

  it("treats null summaries as an unknown snapshot", () => {
    expect(shouldShowPowersNeedsRestart({
      connectorDataReady: true,
      installed: [installedConnector("connector-1")],
      summaries: null,
    })).toBe(false);
  });

  it("shows when a known-empty snapshot differs from enabled connectors", () => {
    expect(shouldShowPowersNeedsRestart({
      connectorDataReady: true,
      installed: [installedConnector("connector-1")],
      summaries: [],
    })).toBe(true);
  });

  it("ignores not-applied connectors that restart cannot fix", () => {
    expect(shouldShowPowersNeedsRestart({
      connectorDataReady: true,
      installed: [installedConnector("connector-1", "filesystem")],
      summaries: [
        summary({
          displayName: "Filesystem",
          id: "connector-1",
          outcome: "not_applied",
          reason: "unsupported_target",
          serverName: "filesystem",
          transport: "stdio",
        }),
      ],
    })).toBe(false);
  });

  it("shows when the enabled connector set differs from applied summaries", () => {
    expect(shouldShowPowersNeedsRestart({
      connectorDataReady: true,
      installed: [installedConnector("connector-1"), installedConnector("connector-2")],
      summaries: [summary({ id: "connector-1" })],
    })).toBe(true);
  });
});
