import { describe, expect, it, vi } from "vitest";
import type { MaterializationIntentResponse } from "@proliferate/cloud-sdk/types";
import { runOpenOnMacFlow } from "#product/lib/domain/workspaces/cloud/open-on-mac-orchestration";

const HEAD = "abc123";
const BRANCH = "feat/x";

function intentResponse(): MaterializationIntentResponse {
  return {
    operationId: "row-1:2",
    materialization: {
      id: "row-1",
      targetKind: "local_desktop",
      desktopInstallId: "mac-a",
      anyharnessWorkspaceId: null,
      worktreePath: null,
      state: "pending",
      generation: 2,
      expectedHeadSha: HEAD,
      observedHeadSha: null,
      observedBranch: BRANCH,
      failureCode: null,
      lastReportedAt: null,
    },
    source: {
      repository: { provider: "github", owner: "acme", name: "rocket", branch: BRANCH, baseBranch: "main" },
      branchName: BRANCH,
      headSha: HEAD,
    },
  } as MaterializationIntentResponse;
}

function callbacks(overrides: Record<string, unknown> = {}) {
  return {
    createIntent: vi.fn(async () => intentResponse()),
    materializeRepoRoot: vi.fn(async () => ({
      repoRoot: {
        id: "root-1",
        kind: "managed",
        path: "/code/rocket",
        remoteProvider: "github",
        remoteOwner: "acme",
        remoteRepoName: "rocket",
        createdAt: "",
        updatedAt: "",
      },
    })),
    materializeWorkspaceAtRef: vi.fn(async () => ({
      workspaceId: "ah-local",
      observedHeadSha: HEAD,
      worktreePath: "/code/rocket-wt",
    })),
    report: vi.fn(async () => ({})),
    ...overrides,
  } as any;
}

describe("runOpenOnMacFlow", () => {
  it("threads a DISTINCT workspace-step id derived from the Cloud operationId and reports exactly", async () => {
    const cb = callbacks();
    const result = await runOpenOnMacFlow({ existingRepoRootId: "root-1" }, cb);

    expect(cb.materializeRepoRoot).not.toHaveBeenCalled();
    // The workspace step derives its id from the root op id, never the verbatim
    // root (which would collide with the repo-root step under PR 3's shared
    // operation_id PRIMARY KEY). See PR5-OPID-05.
    expect(cb.materializeWorkspaceAtRef).toHaveBeenCalledWith("root-1", {
      operationId: "row-1:2:workspace",
      branchName: BRANCH,
      headSha: HEAD,
      destinationId: undefined,
    });
    expect(cb.report).toHaveBeenCalledWith("row-1", {
      generation: 2,
      state: "hydrated",
      anyharnessWorkspaceId: "ah-local",
      worktreePath: "/code/rocket-wt",
      observedBranch: BRANCH,
      observedHeadSha: HEAD,
    });
    expect(result.anyharnessWorkspaceId).toBe("ah-local");
  });

  it("derives DISTINCT per-step ids for the repo-root and workspace steps", async () => {
    const cb = callbacks();
    await runOpenOnMacFlow(
      { existingRepoRootId: null, cloneDestinationPath: "/code/rocket" },
      cb,
    );

    const repoRootId = cb.materializeRepoRoot.mock.calls[0]![0].operationId;
    const workspaceId = cb.materializeWorkspaceAtRef.mock.calls[0]![1].operationId;
    expect(repoRootId).toBe("row-1:2:repo-root");
    expect(workspaceId).toBe("row-1:2:workspace");
    // The two steps must never share one operation id (that shared-id reuse is
    // exactly what PR 3 rejects with MATERIALIZATION_OPERATION_CONFLICT).
    expect(repoRootId).not.toBe(workspaceId);

    expect(cb.materializeRepoRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationPath: "/code/rocket",
        mode: "clone_or_adopt",
        repository: expect.objectContaining({ cloneUrl: "https://github.com/acme/rocket.git" }),
      }),
    );
    expect(cb.materializeWorkspaceAtRef).toHaveBeenCalledWith("root-1", expect.anything());
  });

  it("forces a fresh worktree (destinationId) only in recreate mode", async () => {
    const relinkCb = callbacks();
    await runOpenOnMacFlow({ existingRepoRootId: "root-1" }, relinkCb);
    expect(relinkCb.materializeWorkspaceAtRef.mock.calls[0]![1].destinationId).toBeUndefined();

    const recreateCb = callbacks();
    await runOpenOnMacFlow({ existingRepoRootId: "root-1", forceFreshWorktree: true }, recreateCb);
    const destinationId = recreateCb.materializeWorkspaceAtRef.mock.calls[0]![1].destinationId;
    expect(destinationId).toBe("recreate-row-1:2".replace(/[^A-Za-z0-9._-]/gu, "-"));
    // A single path segment: no slashes, ≤96 chars (PR 3 destinationId contract).
    expect(destinationId).not.toContain("/");
    expect(destinationId!.length).toBeLessThanOrEqual(96);
  });

  it("reuses the SAME per-step ids across a re-issued (crash-retry) run and reports once per success", async () => {
    // Two runs with the same re-issued intent (the operationId is stable because
    // the Cloud intent is idempotent on reuse). The per-step ids must be
    // identical across runs so PR 3 replays rather than cutting a second
    // worktree, and each successful run reports exactly once (PR5-RETRY-09).
    const cb1 = callbacks();
    await runOpenOnMacFlow({ existingRepoRootId: null, cloneDestinationPath: "/code/rocket" }, cb1);
    const cb2 = callbacks();
    await runOpenOnMacFlow({ existingRepoRootId: null, cloneDestinationPath: "/code/rocket" }, cb2);

    expect(cb2.materializeRepoRoot.mock.calls[0]![0].operationId)
      .toBe(cb1.materializeRepoRoot.mock.calls[0]![0].operationId);
    expect(cb2.materializeWorkspaceAtRef.mock.calls[0]![1].operationId)
      .toBe(cb1.materializeWorkspaceAtRef.mock.calls[0]![1].operationId);
    expect(cb1.report).toHaveBeenCalledTimes(1);
    expect(cb2.report).toHaveBeenCalledTimes(1);
  });

  it("does not report when materialization fails (pending intent left for retry)", async () => {
    const cb = callbacks({
      materializeWorkspaceAtRef: vi.fn(async () => {
        throw new Error("busy");
      }),
    });

    await expect(
      runOpenOnMacFlow({ existingRepoRootId: "root-1" }, cb),
    ).rejects.toThrow("busy");
    expect(cb.report).not.toHaveBeenCalled();
  });

  it("rejects a wrong adopted repo root without materializing a workspace", async () => {
    const cb = callbacks({
      materializeRepoRoot: vi.fn(async () => ({
        repoRoot: {
          id: "root-x",
          kind: "managed",
          path: "/code/other",
          remoteProvider: "github",
          remoteOwner: "other",
          remoteRepoName: "different",
          createdAt: "",
          updatedAt: "",
        },
      })),
    });

    await expect(
      runOpenOnMacFlow(
        { existingRepoRootId: null, cloneDestinationPath: "/code/rocket" },
        cb,
      ),
    ).rejects.toThrow(/does not match/);
    expect(cb.materializeWorkspaceAtRef).not.toHaveBeenCalled();
    expect(cb.report).not.toHaveBeenCalled();
  });
});
