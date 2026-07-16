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
  it("threads the Cloud operationId into the exact-ref materialization and reports exactly", async () => {
    const cb = callbacks();
    const result = await runOpenOnMacFlow({ existingRepoRootId: "root-1" }, cb);

    expect(cb.materializeRepoRoot).not.toHaveBeenCalled();
    expect(cb.materializeWorkspaceAtRef).toHaveBeenCalledWith("root-1", {
      operationId: "row-1:2",
      branchName: BRANCH,
      headSha: HEAD,
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

  it("clones a repo root first when none exists, reusing the operation id", async () => {
    const cb = callbacks();
    await runOpenOnMacFlow(
      { existingRepoRootId: null, cloneDestinationPath: "/code/rocket" },
      cb,
    );

    expect(cb.materializeRepoRoot).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "row-1:2",
        destinationPath: "/code/rocket",
        mode: "clone_or_adopt",
        repository: expect.objectContaining({ cloneUrl: "https://github.com/acme/rocket.git" }),
      }),
    );
    expect(cb.materializeWorkspaceAtRef).toHaveBeenCalledWith("root-1", expect.anything());
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
