import type { SessionMcpBindingSummary } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG } from "@/config/mcp-catalog";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { shouldShowPowersNeedsRestart } from "./SessionPowersSummary";

function installedConnector(
  connectionId: string,
  catalogEntryId: InstalledConnectorRecord["metadata"]["catalogEntryId"] = "context7",
): InstalledConnectorRecord {
  const catalogEntry = CONNECTOR_CATALOG.find((entry) => entry.id === catalogEntryId);
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
      syncState: "synced",
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
