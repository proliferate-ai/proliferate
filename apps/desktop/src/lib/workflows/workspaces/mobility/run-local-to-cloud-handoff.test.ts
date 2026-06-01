import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceMobilityArchive,
  WorkspaceMobilityPreflightResponse,
} from "@anyharness/sdk";
import {
  runLocalToCloudHandoff,
  type RunLocalToCloudHandoffDeps,
} from "@/lib/workflows/workspaces/mobility/run-local-to-cloud-handoff";

describe("runLocalToCloudHandoff", () => {
  it("moves a local workspace to cloud and schedules source cleanup", async () => {
    const calls: string[] = [];
    const deps = localToCloudDeps(calls);

    await runLocalToCloudHandoff({
      snapshot: {
        logicalWorkspaceId: "logical-1",
        mobilityWorkspaceId: "mobility-1",
        sourceWorkspaceId: "local-1",
        sourcePreflight: sourcePreflight(),
        cloudPreflight: { excludedPaths: ["node_modules"] },
      },
    }, deps);
    await flushMicrotasks();

    expect(calls.slice(0, 13)).toEqual([
      "start",
      "detail",
      "wait-ready",
      "invalidate",
      "update-runtime",
      "phase:source_frozen",
      "phase:destination_ready",
      "export",
      "install",
      "phase:install_succeeded",
      "update-runtime",
      "finalize",
      "clear-owner-cache",
    ]);
    expect(deps.installArchive).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "cloud:cloud-1",
      operationId: "handoff-1",
    }));
    expect(deps.selectWorkspace).toHaveBeenCalledWith("cloud:cloud-1", { force: true });
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
      workspaceId: "local-1",
    },
    workspaceId: "local-1",
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

function localToCloudDeps(calls: string[]): RunLocalToCloudHandoffDeps {
  return {
    startHandoff: vi.fn(async () => {
      calls.push("start");
      return { id: "handoff-1" };
    }),
    loadCloudMobilityWorkspaceDetail: vi.fn(async () => {
      calls.push("detail");
      return { cloudWorkspaceId: "cloud-1" };
    }),
    waitForCloudWorkspaceReady: vi.fn(async () => {
      calls.push("wait-ready");
    }),
    invalidateWorkspaceCollections: vi.fn(async () => {
      calls.push("invalidate");
    }),
    updateRuntimeState: vi.fn(async () => {
      calls.push("update-runtime");
    }),
    updatePhase: vi.fn(async (input) => {
      calls.push(`phase:${input.input.phase}`);
    }),
    exportArchive: vi.fn(async () => {
      calls.push("export");
      return archiveFixture();
    }),
    installArchive: vi.fn(async () => {
      calls.push("install");
    }),
    finalizeHandoff: vi.fn(async () => {
      calls.push("finalize");
    }),
    clearWorkspaceOwnerFlipCache: vi.fn(async () => {
      calls.push("clear-owner-cache");
    }),
    clearWorkspaceRuntimeState: vi.fn(() => {
      calls.push("clear-runtime");
    }),
    refreshWorkspaceCollections: vi.fn(async () => {
      calls.push("refresh");
    }),
    selectWorkspace: vi.fn(async () => {
      calls.push("select");
    }),
    showMcpNotice: vi.fn(() => {
      calls.push("mcp-notice");
    }),
    cleanupWorkspace: vi.fn(async () => {
      calls.push("cleanup");
    }),
    completeCleanup: vi.fn(async () => {
      calls.push("complete-cleanup");
    }),
    failHandoff: vi.fn(async () => {
      calls.push("fail");
    }),
    resolveFinalizationAfterAmbiguousCutover: vi.fn(async () => "not_finalized" as const),
    showToast: vi.fn((message) => {
      calls.push(`toast:${message}`);
    }),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
