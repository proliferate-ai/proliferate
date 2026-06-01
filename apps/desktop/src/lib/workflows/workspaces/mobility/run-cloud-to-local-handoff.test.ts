import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceMobilityArchive,
  WorkspaceMobilityPreflightResponse,
} from "@anyharness/sdk";
import {
  runCloudToLocalHandoff,
  type RunCloudToLocalHandoffDeps,
} from "@/lib/workflows/workspaces/mobility/run-cloud-to-local-handoff";

describe("runCloudToLocalHandoff", () => {
  it("does not start when the local repo root is missing", async () => {
    const deps = cloudToLocalDeps();

    await runCloudToLocalHandoff({
      snapshot: {
        logicalWorkspaceId: "logical-1",
        mobilityWorkspaceId: "mobility-1",
        sourceWorkspaceId: "cloud-runtime-1",
        sourcePreflight: sourcePreflight(),
      },
      repoRootId: null,
      previousCloudWorkspaceId: "cloud-1",
    }, deps);

    expect(deps.startHandoff).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(
      "Workspace mobility requires a local repo root, branch, and base commit.",
    );
  });

  it("moves a cloud workspace back to a prepared local destination", async () => {
    const deps = cloudToLocalDeps();

    await runCloudToLocalHandoff({
      snapshot: {
        logicalWorkspaceId: "logical-1",
        mobilityWorkspaceId: "mobility-1",
        sourceWorkspaceId: "cloud-runtime-1",
        sourcePreflight: sourcePreflight(),
      },
      repoRootId: "repo-root-1",
      preferredWorkspaceName: "Feature Move",
      previousCloudWorkspaceId: "cloud-1",
    }, deps);
    await flushMicrotasks();

    expect(deps.prepareDestination).toHaveBeenCalledWith({
      repoRootId: "repo-root-1",
      input: {
        requestedBranch: "feature/move",
        requestedBaseSha: "abc123",
        preferredWorkspaceName: "Feature Move",
      },
    });
    expect(deps.selectWorkspace).toHaveBeenCalledWith("local-destination-1", { force: true });
    expect(deps.completeCleanup).toHaveBeenCalledWith({
      mobilityWorkspaceId: "mobility-1",
      handoffOpId: "handoff-1",
    });
  });
});

function sourcePreflight(): WorkspaceMobilityPreflightResponse {
  return {
    canMove: true,
    blockers: [],
    sessions: [],
    branchName: "feature/move",
    baseCommitSha: "abc123",
    runtimeState: {
      mode: "normal",
      updatedAt: "2026-06-01T00:00:00.000Z",
      workspaceId: "cloud-runtime-1",
    },
    workspaceId: "cloud-runtime-1",
  };
}

function archiveFixture(): WorkspaceMobilityArchive {
  return {
    baseCommitSha: "abc123",
    branchName: "feature/move",
    files: [],
    repoRootPath: "/repo",
    sessions: [],
    sourceWorkspacePath: "/repo/workspace",
  };
}

function cloudToLocalDeps(): RunCloudToLocalHandoffDeps {
  return {
    startHandoff: vi.fn(async () => ({ id: "handoff-1" })),
    prepareDestination: vi.fn(async () => ({
      workspace: { id: "local-destination-1" },
      created: true,
    })),
    updateRuntimeState: vi.fn(async () => undefined),
    updatePhase: vi.fn(async () => undefined),
    exportArchive: vi.fn(async () => archiveFixture()),
    installArchive: vi.fn(async () => undefined),
    finalizeHandoff: vi.fn(async () => undefined),
    clearWorkspaceOwnerFlipCache: vi.fn(async () => undefined),
    clearWorkspaceRuntimeState: vi.fn(),
    refreshWorkspaceCollections: vi.fn(async () => undefined),
    selectWorkspace: vi.fn(async () => undefined),
    showMcpNotice: vi.fn(),
    cleanupWorkspace: vi.fn(async () => undefined),
    completeCleanup: vi.fn(async () => undefined),
    failHandoff: vi.fn(async () => undefined),
    purgePreparedDestination: vi.fn(async () => undefined),
    invalidateWorkspaceCollections: vi.fn(async () => undefined),
    resolveFinalizationAfterAmbiguousCutover: vi.fn(async () => "not_finalized" as const),
    showToast: vi.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
