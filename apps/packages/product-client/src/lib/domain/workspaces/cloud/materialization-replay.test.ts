import { describe, expect, it, vi } from "vitest";
import { buildReplayContext } from "#product/lib/domain/workspaces/cloud/materialization-replay";
import {
  repoRootOperationId,
  runMaterializeAndReportSteps,
  workspaceOperationId,
} from "#product/lib/domain/workspaces/cloud/open-on-mac-orchestration";
import { planMaterializationReconciliation } from "#product/lib/domain/workspaces/cloud/materialization-reconciliation";
import type { CloudWorkspaceMaterializationSummary, CloudWorkspaceRepoRef } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";

const HEAD = "a".repeat(40);
const BRANCH = "feat/x";
const repo: CloudWorkspaceRepoRef = {
  provider: "github",
  owner: "acme",
  name: "rocket",
  branch: BRANCH,
  baseBranch: "main",
};

function interruptedRow(
  overrides: Partial<CloudWorkspaceMaterializationSummary> = {},
): CloudWorkspaceMaterializationSummary {
  return {
    id: "row-7",
    targetKind: "local_desktop",
    desktopInstallId: "mac-a",
    anyharnessWorkspaceId: null,
    worktreePath: null,
    state: "hydrating",
    generation: 3,
    expectedHeadSha: HEAD,
    observedHeadSha: null,
    observedBranch: BRANCH,
    failureCode: null,
    lastReportedAt: null,
    ...overrides,
  };
}

describe("buildReplayContext", () => {
  it("re-issues the EXACT {rowId}:{generation} op id from the interrupted row", () => {
    const context = buildReplayContext({ row: interruptedRow(), repo });
    expect(context?.operationId).toBe("row-7:3");
    expect(context?.materializationId).toBe("row-7");
    expect(context?.generation).toBe(3);
    expect(context?.branchName).toBe(BRANCH);
    expect(context?.headSha).toBe(HEAD);
  });

  it("returns null when the source ref can't be reconstructed (no repo / no head)", () => {
    expect(buildReplayContext({ row: interruptedRow(), repo: null })).toBeNull();
    expect(
      buildReplayContext({ row: interruptedRow({ expectedHeadSha: null, observedHeadSha: null }), repo }),
    ).toBeNull();
  });
});

describe("interrupted-operation replay convergence", () => {
  it("replays with IDENTICAL per-step ids, reports exactly once, and converges", async () => {
    const context = buildReplayContext({ row: interruptedRow(), repo })!;
    const materializeWorkspaceAtRef = vi.fn(
      async (_repoRootId: string, _input: { operationId: string; branchName: string; headSha: string }) => ({
        workspaceId: "ah-local",
        observedHeadSha: HEAD,
        worktreePath: "/code/rocket-wt",
      }),
    );
    const report = vi.fn(async (_materializationId: string, _body: unknown) => ({}));
    const materializeRepoRoot = vi.fn(async () => ({ repoRoot: {} as never }));

    const result = await runMaterializeAndReportSteps(
      context,
      { existingRepoRootId: "root-1" },
      { materializeRepoRoot, materializeWorkspaceAtRef, report },
    );

    // Existing repo root → no clone step.
    expect(materializeRepoRoot).not.toHaveBeenCalled();
    // The workspace step uses the derived id from the SAME root op id.
    expect(materializeWorkspaceAtRef).toHaveBeenCalledOnce();
    expect(materializeWorkspaceAtRef.mock.calls[0]![1]).toMatchObject({
      operationId: workspaceOperationId("row-7:3"),
      branchName: BRANCH,
      headSha: HEAD,
    });
    // Exactly one hydrated report for the SAME generation.
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]![1]).toMatchObject({
      generation: 3,
      state: "hydrated",
      anyharnessWorkspaceId: "ah-local",
      observedHeadSha: HEAD,
    });
    expect(result.anyharnessWorkspaceId).toBe("ah-local");
  });

  it("derives the same ids on a crash-retry (deterministic per-step ids)", () => {
    // Two independent context builds from the same row yield identical ids, so a
    // crash-retry replays PR 3's ledger result rather than cloning twice.
    const a = buildReplayContext({ row: interruptedRow(), repo })!;
    const b = buildReplayContext({ row: interruptedRow(), repo })!;
    expect(repoRootOperationId(a.operationId)).toBe(repoRootOperationId(b.operationId));
    expect(workspaceOperationId(a.operationId)).toBe(workspaceOperationId(b.operationId));
  });

  it("a second pass AFTER convergence is a no-op (planner emits healthy, no replay)", () => {
    // After the replay reported hydrated with the observed head, the row is
    // hydrated and the local inventory matches → planner returns healthy.
    const converged = interruptedRow({
      state: "hydrated",
      anyharnessWorkspaceId: "ah-local",
      worktreePath: "/code/rocket-wt",
      observedHeadSha: HEAD,
    });
    const [action] = planMaterializationReconciliation({
      rows: [converged],
      inventory: [{
        anyharnessWorkspaceId: "ah-local",
        worktreePath: "/code/rocket-wt",
        observedBranch: BRANCH,
        observedHeadSha: HEAD,
      }],
    });
    expect(action.kind).toBe("healthy");
  });
});
