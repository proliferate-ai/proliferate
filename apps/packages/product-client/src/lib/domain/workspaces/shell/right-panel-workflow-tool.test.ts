import { describe, expect, it, vi } from "vitest";
import {
  availableRightPanelTools,
  resolveWorkflowToolAvailability,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  reconcileRightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-state-normalization";

// The run-scoped half of the workflow tool's visibility is only observable with
// the launch gate on: with it off, normalization drops `tool:workflow` from the
// header order outright and the active entry falls back on that alone.
vi.mock("#product/lib/domain/capabilities/workflows-v2", () => ({
  isWorkflowsV2Enabled: () => true,
}));

describe("resolveWorkflowToolAvailability", () => {
  it("keeps the tab through the loading tick when the user is standing on it", () => {
    expect(resolveWorkflowToolAvailability({
      runsSettled: false,
      hasRun: false,
      isActiveTool: true,
    })).toEqual({ showTab: true, activeEntryAvailability: undefined });
  });

  it("offers nothing on a loading list nobody is standing on, and still decides nothing", () => {
    expect(resolveWorkflowToolAvailability({
      runsSettled: false,
      hasRun: false,
      isActiveTool: false,
    })).toEqual({ showTab: false, activeEntryAvailability: undefined });
  });

  it("retires the tool once a settled list shows no run", () => {
    expect(resolveWorkflowToolAvailability({
      runsSettled: true,
      hasRun: false,
      isActiveTool: true,
    })).toEqual({ showTab: false, activeEntryAvailability: false });
  });

  it("offers the tool while a settled list has a run", () => {
    expect(resolveWorkflowToolAvailability({
      runsSettled: true,
      hasRun: true,
      isActiveTool: false,
    })).toEqual({ showTab: true, activeEntryAvailability: true });
  });
});

describe("right-panel state reconciliation against the workflow run", () => {
  const gatedOnTools = ["tool:workflow", "tool:scratch", "tool:git", "tool:agents"];

  it("has the workflow tool in the gated-on header order", () => {
    expect(availableRightPanelTools(false)).toEqual([
      "workflow",
      "scratch",
      "git",
      "agents",
    ]);
  });

  it("does not bounce the active workflow tool while the runs list is loading", () => {
    const state = reconcileRightPanelWorkspaceState(
      { activeEntryKey: "tool:workflow", headerOrder: [] },
      { isCloudWorkspaceSelected: false, hasWorkflowRun: undefined },
    );

    expect(state.activeEntryKey).toBe("tool:workflow");
  });

  it("falls back to scratch once a settled list shows no run, keeping the stored order", () => {
    const state = reconcileRightPanelWorkspaceState(
      { activeEntryKey: "tool:workflow", headerOrder: [] },
      { isCloudWorkspaceSelected: false, hasWorkflowRun: false },
    );

    expect(state.activeEntryKey).toBe("tool:scratch");
    // The persisted header order is never rewritten on a run's existence: the
    // tab is filtered at render time, so the key survives for the next run.
    expect(state.headerOrder).toEqual(gatedOnTools);
  });

  it("leaves the active workflow tool alone while the workspace has a run", () => {
    const state = reconcileRightPanelWorkspaceState(
      { activeEntryKey: "tool:workflow", headerOrder: [] },
      { isCloudWorkspaceSelected: false, hasWorkflowRun: true },
    );

    expect(state.activeEntryKey).toBe("tool:workflow");
  });

  it("leaves every other active tool alone when there is no run (negative control)", () => {
    for (const activeEntryKey of ["tool:scratch", "tool:git", "tool:agents"] as const) {
      const state = reconcileRightPanelWorkspaceState(
        { activeEntryKey, headerOrder: [] },
        { isCloudWorkspaceSelected: false, hasWorkflowRun: false },
      );

      expect(state.activeEntryKey).toBe(activeEntryKey);
    }
  });

  it("converges after one pass, so a runtime caller never reconciles twice", () => {
    const first = reconcileRightPanelWorkspaceState(
      { activeEntryKey: "tool:workflow", headerOrder: [] },
      { isCloudWorkspaceSelected: false, hasWorkflowRun: false },
    );
    const second = reconcileRightPanelWorkspaceState(first, {
      isCloudWorkspaceSelected: false,
      hasWorkflowRun: false,
    });

    expect(second).toEqual(first);
  });
});
