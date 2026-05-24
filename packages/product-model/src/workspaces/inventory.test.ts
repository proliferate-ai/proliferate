import { describe, expect, it } from "vitest";
import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import {
  buildCloudWorkspaceInventoryItems,
  buildWorkspaceInventoryFilterOptions,
  filterWorkspaceInventoryItems,
  groupWorkspaceInventoryItems,
  workspaceInventorySummaryLabel,
  type WorkspaceInventoryItemView,
} from "./inventory";

describe("workspace inventory model", () => {
  it("derives stable inventory rows from cloud workspace summaries", () => {
    const now = Date.parse("2026-05-24T12:00:00.000Z");
    const items = buildCloudWorkspaceInventoryItems(
      [
        cloudWorkspace({
          id: "automation-workspace",
          displayName: "Nightly rebuild",
          creatorContext: { kind: "automation" },
          lastSessionSummary: {
            title: "Rebuild skills",
            status: "ready-for-review",
            lastEventAt: "2026-05-24T10:00:00.000Z",
          },
        }),
        cloudWorkspace({
          id: "slack-workspace",
          displayName: "Investigate claim",
          origin: { entrypoint: "slack" },
          visibility: "shared_unclaimed",
          updatedAt: "2026-05-24T11:55:00.000Z",
        }),
      ],
      { now },
    );

    expect(items.map((item) => item.id)).toEqual([
      "slack-workspace",
      "automation-workspace",
    ]);
    expect(items[0]).toMatchObject({
      sourceKind: "slack",
      sourceLabel: "Slack",
      ownershipKind: "unclaimed",
      ownerLabel: "Unclaimed",
      updatedLabel: "5m",
    });
    expect(items[1]).toMatchObject({
      sourceKind: "automation",
      sourceLabel: "Automation",
      statusKind: "review",
      statusLabel: "Ready for review",
      sessionLabel: "Rebuild skills",
      updatedLabel: "2h",
    });
    expect(workspaceInventorySummaryLabel(items)).toBe(
      "2 workspaces · 1 unclaimed · 1 ready for review",
    );
  });

  it("filters and groups by ownership kind instead of display labels", () => {
    const items: WorkspaceInventoryItemView[] = [
      inventoryItem({
        id: "unclaimed-with-custom-label",
        ownershipKind: "unclaimed",
        ownerLabel: "Available to claim",
      }),
      inventoryItem({
        id: "mine",
        ownershipKind: "mine",
        ownerLabel: "Mine",
      }),
      inventoryItem({
        id: "claimed",
        ownershipKind: "claimed",
        ownerLabel: "Claimed",
      }),
    ];

    expect(buildWorkspaceInventoryFilterOptions(items)).toEqual([
      { id: "all", label: "All", count: 3 },
      { id: "mine", label: "Mine", count: 1 },
      { id: "unclaimed", label: "Unclaimed", count: 1 },
      { id: "attention", label: "Needs attention", count: 1 },
    ]);
    expect(filterWorkspaceInventoryItems(items, "unclaimed").map((item) => item.id)).toEqual([
      "unclaimed-with-custom-label",
    ]);
    expect(groupWorkspaceInventoryItems(items, "ownership").map((group) => group.id)).toEqual([
      "unclaimed",
      "mine",
      "claimed",
    ]);
  });

  it("preserves Slack as the source when only the claim source carries it", () => {
    const [item] = buildCloudWorkspaceInventoryItems(
      [
        cloudWorkspace({
          origin: { entrypoint: "web", kind: "human" },
          claimSourceKind: "slack",
        }),
      ],
      { now: Date.parse("2026-05-24T12:00:00.000Z") },
    );

    expect(item.sourceKind).toBe("slack");
    expect(item.sourceLabel).toBe("Slack");
  });

  it("pluralizes the summary count", () => {
    expect(workspaceInventorySummaryLabel([inventoryItem()])).toBe("1 workspace");
  });
});

function inventoryItem(
  overrides: Partial<WorkspaceInventoryItemView> = {},
): WorkspaceInventoryItemView {
  return {
    id: "workspace",
    title: "Workspace",
    repoLabel: "proliferate-ai/proliferate",
    branchLabel: "main",
    sourceKind: "chat",
    sourceLabel: "Chat",
    locationKind: "cloud",
    locationLabel: "Cloud",
    scopeLabel: "Personal",
    statusKind: "waiting",
    statusLabel: "Waiting",
    ownershipKind: "mine",
    ownerLabel: "Mine",
    ...overrides,
  };
}

function cloudWorkspace(overrides: Record<string, unknown> = {}): CloudWorkspaceSummary {
  return {
    id: "workspace",
    displayName: "Workspace",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "main",
      baseBranch: "main",
    },
    status: "ready",
    workspaceStatus: "ready",
    runtime: {},
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: "2026-05-24T11:00:00.000Z",
    createdAt: "2026-05-24T09:00:00.000Z",
    postReadyPhase: "complete",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
    exposureState: "tracked",
    sandboxType: "managed_personal",
    ...overrides,
  } as unknown as CloudWorkspaceSummary;
}
