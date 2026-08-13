import { describe, expect, it } from "vitest";
import {
  availableRightPanelTools,
  clampRightPanelWidth,
  normalizeRightPanelDurableState,
  parseRightPanelHeaderEntryKey,
  resolveRightPanelDragOutcome,
  rightPanelViewerHeaderKey,
  RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD,
  RIGHT_PANEL_FALLBACK_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  reorderTerminalInRightPanelState,
  reorderToolInRightPanelState,
} from "#product/lib/domain/workspaces/shell/right-panel-state";
import {
  reconcileRightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-state-normalization";
import { fileViewerTarget } from "#product/lib/domain/workspaces/viewer/viewer-target";

describe("right panel domain", () => {
  it("uses the same built-in tools for local and cloud workspaces", () => {
    expect(availableRightPanelTools(false)).toEqual(["scratch", "git"]);
    expect(availableRightPanelTools(true)).toEqual(["scratch", "git"]);
  });

  it("defaults to scratch for new right-panel state", () => {
    const state = reconcileRightPanelWorkspaceState(undefined, { isCloudWorkspaceSelected: false });

    expect(state.activeEntryKey).toBe("tool:scratch");
    expect(state.headerOrder).toEqual([
      "tool:scratch",
      "tool:git",
    ]);
  });

  it("does not parse retired tools", () => {
    expect(parseRightPanelHeaderEntryKey("tool:files")).toBeNull();
    expect(parseRightPanelHeaderEntryKey("tool:settings")).toBeNull();
  });

  it("does not parse retired browser entry keys", () => {
    expect(parseRightPanelHeaderEntryKey("browser:b1")).toBeNull();
  });

  it("parses viewer target entry keys", () => {
    const target = fileViewerTarget("src/app.ts");
    const key = rightPanelViewerHeaderKey(target);

    expect(parseRightPanelHeaderEntryKey(key)).toEqual({
      kind: "viewer",
      target,
      targetKey: key,
    });
  });

  it("drops the retired cloud settings tab and falls back to scratch", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "tool:settings",
        headerOrder: ["tool:settings", "tool:files"],
      } as never,
      { isCloudWorkspaceSelected: true },
    );

    expect(state.activeEntryKey).toBe("tool:scratch");
    expect(state.headerOrder).toEqual([
      "tool:scratch",
      "tool:git",
    ]);
  });

  it("routes legacy Review tool state to Changes", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "tool:allChanges",
        headerOrder: ["tool:allChanges", "tool:files"],
      } as never,
      { isCloudWorkspaceSelected: false },
    );

    expect(state.activeEntryKey).toBe("tool:git");
    expect(state.headerOrder).toEqual(["tool:scratch", "tool:git"]);
  });

  it("keeps a terminal active when no live terminal list is available", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "terminal:t1",
        headerOrder: ["terminal:t1", "tool:git"],
      },
      { isCloudWorkspaceSelected: false },
    );

    expect(state.activeEntryKey).toBe("terminal:t1");
    expect(state.headerOrder).toEqual([
      "terminal:t1",
      "tool:git",
      "tool:scratch",
    ]);
  });

  it("prunes stale terminals against a successful live list", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "terminal:stale",
        headerOrder: ["terminal:stale", "tool:git", "terminal:t2"],
      },
      {
        isCloudWorkspaceSelected: false,
        liveTerminals: [{ id: "t1" }, { id: "t2" }],
      },
    );

    expect(state.headerOrder).toEqual([
      "tool:git",
      "terminal:t2",
      "tool:scratch",
      "terminal:t1",
    ]);
    expect(state.activeEntryKey).toBe("tool:scratch");
  });

  it("does not append setup terminals unless already in the header", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "tool:git",
        headerOrder: ["tool:git"],
      },
      {
        isCloudWorkspaceSelected: false,
        liveTerminals: [{ id: "setup", purpose: "setup" }, { id: "run", purpose: "run" }],
      },
    );

    expect(state.headerOrder).toEqual([
      "tool:git",
      "tool:scratch",
      "terminal:run",
    ]);
  });

  it("reconciles one mixed header order for tools and terminals", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "terminal:t2",
        headerOrder: ["terminal:t2", "tool:git", "tool:files"],
      } as never,
      {
        isCloudWorkspaceSelected: false,
        liveTerminals: [{ id: "t1" }, { id: "t2" }],
      },
    );

    expect(state.headerOrder).toEqual([
      "terminal:t2",
      "tool:git",
      "tool:scratch",
      "terminal:t1",
    ]);
    expect(state.activeEntryKey).toBe("terminal:t2");
  });

  it("removes a closed terminal and falls back to the nearest sibling", () => {
    const state = removeTerminalFromRightPanelState(
      {
        activeEntryKey: "terminal:t2",
        headerOrder: ["tool:git", "terminal:t1", "terminal:t2", "terminal:t3"],
      },
      "t2",
      false,
    );

    expect(state.headerOrder).toEqual([
      "tool:git",
      "terminal:t1",
      "terminal:t3",
      "tool:scratch",
    ]);
    expect(state.activeEntryKey).toBe("terminal:t1");
  });

  it("reorders terminal ids immediately", () => {
    const state = reorderTerminalInRightPanelState(
      {
        activeEntryKey: "terminal:t1",
        headerOrder: ["terminal:t1", "terminal:t2", "terminal:t3"],
      },
      "t3",
      "t1",
      false,
    );

    expect(state.headerOrder).toEqual([
      "terminal:t3",
      "terminal:t1",
      "terminal:t2",
      "tool:scratch",
      "tool:git",
    ]);
    expect(state.activeEntryKey).toBe("terminal:t1");
  });

  it("reorders tools and terminals across the same header", () => {
    const state = reorderHeaderEntryInRightPanelState(
      {
        activeEntryKey: "tool:git",
        headerOrder: ["tool:files", "terminal:t1", "tool:git", "terminal:t2"],
      } as never,
      "terminal:t2",
      "tool:git",
      false,
    );

    expect(state.headerOrder).toEqual([
      "terminal:t1",
      "terminal:t2",
      "tool:git",
      "tool:scratch",
    ]);
  });

  it("reorders singleton tools via the shared header order", () => {
    const state = reorderToolInRightPanelState(
      {
        activeEntryKey: "tool:git",
        headerOrder: ["tool:git", "tool:scratch"],
      },
      "scratch",
      "git",
      true,
    );

    expect(state.headerOrder).toEqual([
      "tool:scratch",
      "tool:git",
    ]);
    expect(state.activeEntryKey).toBe("tool:git");
  });

  it("keeps live viewer targets in the shared header order", () => {
    const target = fileViewerTarget("src/app.ts");
    const targetKey = rightPanelViewerHeaderKey(target);
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: targetKey,
        headerOrder: ["tool:files", targetKey],
      } as never,
      {
        isCloudWorkspaceSelected: false,
        liveViewerTargets: [target],
      },
    );

    expect(state.headerOrder).toEqual([
      targetKey,
      "tool:scratch",
      "tool:git",
    ]);
    expect(state.activeEntryKey).toBe(targetKey);
  });

  it("clamps persisted right panel widths to the legible minimum", () => {
    expect(clampRightPanelWidth(100)).toBe(380);
    // No fixed maximum: a width chosen on a larger window persists and
    // restores intact; per-window bounding is the rail's rendered clamp and
    // the drag's measured ceiling.
    expect(clampRightPanelWidth(900)).toBe(900);
    expect(clampRightPanelWidth(900, 700)).toBe(700);
    // A ceiling below the floor (degenerately small window) pins to the floor.
    expect(clampRightPanelWidth(900, 100)).toBe(380);
    expect(clampRightPanelWidth(Number.NaN)).toBe(420);
    expect(RIGHT_PANEL_MIN_WIDTH).toBe(380);
    expect(RIGHT_PANEL_FALLBACK_MAX_WIDTH).toBe(700);
  });

  it("re-clamps widths persisted below the raised minimum", () => {
    // Windows that stored the previous 260px floor must come back legible
    // rather than reopening at a width the panel no longer supports.
    expect(normalizeRightPanelDurableState({ open: true, width: 260 })).toEqual({
      open: true,
      width: RIGHT_PANEL_MIN_WIDTH,
    });
  });

  it("keeps the collapse threshold below the minimum so clamping cannot express it", () => {
    expect(RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD).toBeLessThan(RIGHT_PANEL_MIN_WIDTH);
  });

  it("resizes while the dragged width stays above the collapse threshold", () => {
    expect(resolveRightPanelDragOutcome(520)).toEqual({ kind: "resize", width: 520 });
    // Between the threshold and the minimum the panel sticks at its minimum:
    // this is the resistance a user feels before the panel will close.
    expect(resolveRightPanelDragOutcome(RIGHT_PANEL_MIN_WIDTH - 1)).toEqual({
      kind: "resize",
      width: RIGHT_PANEL_MIN_WIDTH,
    });
    expect(resolveRightPanelDragOutcome(RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD)).toEqual({
      kind: "resize",
      width: RIGHT_PANEL_MIN_WIDTH,
    });
    // The ceiling is the caller's per-gesture measurement, not a constant.
    expect(resolveRightPanelDragOutcome(2000, 1580)).toEqual({
      kind: "resize",
      width: 1580,
    });
    expect(resolveRightPanelDragOutcome(2000)).toEqual({
      kind: "resize",
      width: 2000,
    });
  });

  it("collapses instead of sticking once the drag passes the threshold", () => {
    expect(resolveRightPanelDragOutcome(RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD - 1)).toEqual({
      kind: "collapse",
    });
    expect(resolveRightPanelDragOutcome(0)).toEqual({ kind: "collapse" });
    expect(resolveRightPanelDragOutcome(-120)).toEqual({ kind: "collapse" });
  });

  it("treats a non-finite drag width as a resize, never a collapse", () => {
    // A broken measurement must not close the panel behind the user's back.
    expect(resolveRightPanelDragOutcome(Number.NaN)).toEqual({ kind: "resize", width: 420 });
  });
});
