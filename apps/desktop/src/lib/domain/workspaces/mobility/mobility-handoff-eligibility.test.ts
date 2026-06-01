import { describe, expect, it } from "vitest";
import type { WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import {
  isWorkspaceMobilityConfirmSnapshotReadyToMove,
  withRequiredWorkspaceMobilitySourceMetadata,
} from "@/lib/domain/workspaces/mobility/mobility-handoff-eligibility";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";

describe("workspace mobility handoff eligibility", () => {
  it("adds blockers when source metadata is missing", () => {
    const preflight = sourcePreflight({
      branchName: "",
      baseCommitSha: null,
      canMove: true,
    });

    const result = withRequiredWorkspaceMobilitySourceMetadata(preflight, "main");

    expect(result.branchName).toBe("main");
    expect(result.canMove).toBe(false);
    expect(result.blockers?.map((blocker) => blocker.code)).toEqual([
      "missing_branch_name",
      "missing_base_commit_sha",
    ]);
  });

  it("keeps source metadata when present", () => {
    const preflight = sourcePreflight({
      branchName: " feature/test ",
      baseCommitSha: "abc123",
      canMove: true,
    });

    const result = withRequiredWorkspaceMobilitySourceMetadata(preflight, "main");

    expect(result.branchName).toBe("feature/test");
    expect(result.baseCommitSha).toBe("abc123");
    expect(result.canMove).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("requires both source and cloud preflight success before moving", () => {
    expect(isWorkspaceMobilityConfirmSnapshotReadyToMove(confirmSnapshot())).toBe(true);
    expect(isWorkspaceMobilityConfirmSnapshotReadyToMove(confirmSnapshot({
      sourcePreflight: sourcePreflight({ canMove: false }),
    }))).toBe(false);
    expect(isWorkspaceMobilityConfirmSnapshotReadyToMove(confirmSnapshot({
      cloudPreflight: { canStart: false, blockers: [], excludedPaths: [] },
    }))).toBe(false);
    expect(isWorkspaceMobilityConfirmSnapshotReadyToMove(confirmSnapshot({
      sourcePreflight: sourcePreflight({
        canMove: true,
        blockers: [{ code: "workspace_dirty", message: "Dirty", sessionId: undefined }],
      }),
    }))).toBe(false);
  });
});

function sourcePreflight(
  overrides: Partial<WorkspaceMobilityPreflightResponse> = {},
): WorkspaceMobilityPreflightResponse {
  return {
    canMove: true,
    blockers: [],
    sessions: [],
    branchName: "feature/test",
    baseCommitSha: "abc123",
    ...overrides,
  } as WorkspaceMobilityPreflightResponse;
}

function confirmSnapshot(
  overrides: Partial<WorkspaceMobilityConfirmSnapshot> = {},
): WorkspaceMobilityConfirmSnapshot {
  return {
    logicalWorkspaceId: "logical-1",
    direction: "local_to_cloud",
    sourceWorkspaceId: "workspace-1",
    mobilityWorkspaceId: "mobility-1",
    sourcePreflight: sourcePreflight(),
    cloudPreflight: { canStart: true, blockers: [], excludedPaths: [] },
    ...overrides,
  };
}
