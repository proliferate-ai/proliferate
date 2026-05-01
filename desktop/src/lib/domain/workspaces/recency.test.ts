import { describe, expect, it } from "vitest";
import {
  compareLogicalWorkspaceRecency,
  resolveLogicalWorkspaceRecency,
} from "./recency";
import { makeLocalLogicalWorkspace } from "./sidebar-test-fixtures";

describe("logical workspace recency", () => {
  it("uses work activity as the sort and display timestamp when present", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "workspace-a",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      updatedAt: "2026-04-13T12:00:00.000Z",
    });

    expect(resolveLogicalWorkspaceRecency(workspace, {
      [workspace.id]: "2026-04-13T10:00:00.000Z",
    })).toEqual({
      activityAt: "2026-04-13T10:00:00.000Z",
      recordUpdatedAt: "2026-04-13T12:00:00.000Z",
      sortAt: "2026-04-13T10:00:00.000Z",
      displayAt: "2026-04-13T10:00:00.000Z",
    });
  });

  it("falls back to record updated time only when no activity exists", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "workspace-a",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      updatedAt: "2026-04-13T12:00:00.000Z",
    });

    expect(resolveLogicalWorkspaceRecency(workspace, {})).toMatchObject({
      activityAt: null,
      sortAt: "2026-04-13T12:00:00.000Z",
      displayAt: null,
    });
  });

  it("uses runtime execution summary activity for unmounted background work", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "workspace-a",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      updatedAt: "2026-04-13T09:00:00.000Z",
      executionSummary: {
        phase: "running",
        totalSessionCount: 1,
        liveSessionCount: 1,
        runningCount: 1,
        awaitingInteractionCount: 0,
        idleCount: 0,
        erroredCount: 0,
        updatedAt: "2026-04-13T11:00:00.000Z",
      },
    });

    expect(resolveLogicalWorkspaceRecency(workspace, {})).toMatchObject({
      activityAt: "2026-04-13T11:00:00.000Z",
      sortAt: "2026-04-13T11:00:00.000Z",
      displayAt: "2026-04-13T11:00:00.000Z",
    });
  });

  it("orders by work activity before structural record freshness", () => {
    const renamedButOlderWork = makeLocalLogicalWorkspace({
      id: "renamed",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      updatedAt: "2026-04-13T12:00:00.000Z",
    });
    const olderRecordButNewerWork = makeLocalLogicalWorkspace({
      id: "worked",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      updatedAt: "2026-04-13T11:00:00.000Z",
    });

    expect(compareLogicalWorkspaceRecency(renamedButOlderWork, olderRecordButNewerWork, {
      [renamedButOlderWork.id]: "2026-04-13T10:00:00.000Z",
      [olderRecordButNewerWork.id]: "2026-04-13T11:30:00.000Z",
    })).toBeGreaterThan(0);
  });
});
