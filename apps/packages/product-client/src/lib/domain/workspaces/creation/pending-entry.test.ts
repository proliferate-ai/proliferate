import { describe, expect, it } from "vitest";
import {
  buildSubmittingPendingWorkspaceEntry,
  pendingWorkspaceEntryOwnsSelection,
  pendingWorkspaceEntrySurvivesWorkspaceSwitch,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";

function entry(overrides: Partial<PendingWorkspaceEntry> = {}): PendingWorkspaceEntry {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "snipe",
      request: { kind: "worktree", input: { repoRootId: "repo-1" } },
    }),
    ...overrides,
  };
}

describe("pendingWorkspaceEntrySurvivesWorkspaceSwitch", () => {
  it("keeps in-flight worktree and local creations", () => {
    expect(pendingWorkspaceEntrySurvivesWorkspaceSwitch(entry())).toBe(true);
    expect(pendingWorkspaceEntrySurvivesWorkspaceSwitch(entry({ source: "local-created" })))
      .toBe(true);
  });

  it("clears failed entries so navigating away dismisses the receipt", () => {
    expect(pendingWorkspaceEntrySurvivesWorkspaceSwitch(entry({ stage: "failed" }))).toBe(false);
  });

  it("clears cloud and cowork creations, whose flows assume selection", () => {
    expect(pendingWorkspaceEntrySurvivesWorkspaceSwitch(entry({ source: "cloud-created" })))
      .toBe(false);
    expect(pendingWorkspaceEntrySurvivesWorkspaceSwitch(
      entry({ source: "cloud-created", stage: "awaiting-cloud-ready" }),
    )).toBe(false);
    expect(pendingWorkspaceEntrySurvivesWorkspaceSwitch(entry({ source: "cowork-created" })))
      .toBe(false);
  });
});

describe("pendingWorkspaceEntryOwnsSelection", () => {
  it("owns the pending shell surface (no real workspace selected)", () => {
    expect(pendingWorkspaceEntryOwnsSelection(entry(), null)).toBe(true);
  });

  it("owns its own materialized workspace during handoff", () => {
    expect(pendingWorkspaceEntryOwnsSelection(
      entry({ workspaceId: "workspace-9" }),
      "workspace-9",
    )).toBe(true);
  });

  it("does not own another selected workspace's surface", () => {
    expect(pendingWorkspaceEntryOwnsSelection(entry(), "workspace-2")).toBe(false);
    expect(pendingWorkspaceEntryOwnsSelection(
      entry({ workspaceId: "workspace-9" }),
      "workspace-2",
    )).toBe(false);
  });
});
