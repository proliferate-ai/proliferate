import { describe, expect, it } from "vitest";
import {
  materializationOperationIdFor,
  planMaterializationReconciliation,
  type LocalInventoryEntry,
} from "#product/lib/domain/workspaces/cloud/materialization-reconciliation";
import type { CloudWorkspaceMaterializationSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function row(
  overrides: Partial<CloudWorkspaceMaterializationSummary> = {},
): CloudWorkspaceMaterializationSummary {
  return {
    id: "mat-1",
    targetKind: "local_desktop",
    desktopInstallId: "mac-a",
    anyharnessWorkspaceId: "ws-1",
    worktreePath: "/repo/ws-1",
    state: "hydrated",
    generation: 2,
    expectedHeadSha: HEAD_A,
    observedHeadSha: HEAD_A,
    observedBranch: "feat/x",
    failureCode: null,
    lastReportedAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<LocalInventoryEntry> = {}): LocalInventoryEntry {
  return {
    anyharnessWorkspaceId: "ws-1",
    worktreePath: "/repo/ws-1",
    observedBranch: "feat/x",
    observedHeadSha: HEAD_A,
    ...overrides,
  };
}

describe("materializationOperationIdFor", () => {
  it("is the single-generation idempotency root {rowId}:{generation}", () => {
    expect(materializationOperationIdFor("mat-1", 2)).toBe("mat-1:2");
  });
});

describe("planMaterializationReconciliation", () => {
  it("reports a row with no matching local id as missing", () => {
    const [action] = planMaterializationReconciliation({
      rows: [row({ state: "hydrated" })],
      inventory: [],
    });
    expect(action.kind).toBe("report-missing");
    expect(action.report).toEqual({ generation: 2, state: "missing" });
  });

  it("reports a moved worktree path as missing", () => {
    const [action] = planMaterializationReconciliation({
      rows: [row()],
      inventory: [entry({ worktreePath: "/repo/moved" })],
    });
    expect(action.kind).toBe("report-missing");
  });

  it("reports a HEAD mismatch as inconsistent with observed fields (never re-hydrated)", () => {
    const [action] = planMaterializationReconciliation({
      rows: [row({ observedHeadSha: HEAD_A })],
      inventory: [entry({ observedHeadSha: HEAD_B })],
    });
    expect(action.kind).toBe("report-inconsistent");
    expect(action.report).toMatchObject({
      state: "inconsistent",
      observedHeadSha: HEAD_B,
      observedBranch: "feat/x",
    });
  });

  it("reports a branch mismatch as inconsistent", () => {
    const [action] = planMaterializationReconciliation({
      rows: [row({ observedBranch: "feat/x" })],
      inventory: [entry({ observedBranch: "feat/y" })],
    });
    expect(action.kind).toBe("report-inconsistent");
    expect(action.report).toMatchObject({ state: "inconsistent", observedBranch: "feat/y" });
  });

  it("is healthy when the local checkout matches the ledger", () => {
    const [action] = planMaterializationReconciliation({
      rows: [row()],
      inventory: [entry()],
    });
    expect(action.kind).toBe("healthy");
  });

  it("does not re-report a row that is already missing / inconsistent", () => {
    expect(
      planMaterializationReconciliation({ rows: [row({ state: "missing" })], inventory: [] })[0]!.kind,
    ).toBe("healthy");
    expect(
      planMaterializationReconciliation({
        rows: [row({ state: "inconsistent", observedHeadSha: HEAD_A })],
        inventory: [entry({ observedHeadSha: HEAD_B })],
      })[0]!.kind,
    ).toBe("healthy");
  });

  it("replays an interrupted (pending/hydrating) operation for the SAME generation", () => {
    const [action] = planMaterializationReconciliation({
      rows: [row({ state: "hydrating", generation: 5 })],
      inventory: [],
    });
    expect(action.kind).toBe("replay-operation");
    expect(action.replayOperationId).toBe("mat-1:5");
  });

  it("preserves records for an unreachable runtime (never reports missing)", () => {
    const [action] = planMaterializationReconciliation({
      rows: [row({ state: "hydrated" })],
      inventory: [],
      unreachableAnyharnessWorkspaceIds: ["ws-1"],
    });
    expect(action.kind).toBe("unreachable-preserve");
  });

  it("ignores non-local_desktop rows (bounded scope)", () => {
    expect(
      planMaterializationReconciliation({
        rows: [row({ targetKind: "managed_cloud" })],
        inventory: [],
      }),
    ).toEqual([]);
  });
});
