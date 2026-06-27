import { describe, expect, it } from "vitest";
import {
  RIGHT_PANEL_BROWSER_TAB_LIMIT,
  availableRightPanelTools,
  clampRightPanelWidth,
  parseRightPanelHeaderEntryKey,
  rightPanelViewerHeaderKey,
} from "./right-panel-model";
import {
  canCreateRightPanelBrowserTab,
  createBrowserTabInRightPanelState,
  createOrActivateBrowserTabInRightPanelState,
  removeBrowserTabFromRightPanelState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  reorderTerminalInRightPanelState,
  reorderToolInRightPanelState,
  updateBrowserTabUrlInRightPanelState,
} from "./right-panel-state";
import {
  reconcileRightPanelWorkspaceState,
} from "./right-panel-state-normalization";
import { fileViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";

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

  it("parses browser entry keys", () => {
    expect(parseRightPanelHeaderEntryKey("browser:b1")).toEqual({
      kind: "browser",
      browserId: "b1",
    });
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

  it("reconciles one mixed header order for tools, terminals, and browsers", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "browser:b1",
        headerOrder: ["browser:b1", "terminal:t2", "tool:git", "tool:files"],
        browserTabsById: {
          b1: { id: "b1", url: null },
        },
      } as never,
      {
        isCloudWorkspaceSelected: false,
        liveTerminals: [{ id: "t1" }, { id: "t2" }],
      },
    );

    expect(state.headerOrder).toEqual([
      "browser:b1",
      "terminal:t2",
      "tool:git",
      "tool:scratch",
      "terminal:t1",
    ]);
    expect(state.activeEntryKey).toBe("browser:b1");
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

  it("creates, updates, and removes browser tabs atomically", () => {
    const created = createBrowserTabInRightPanelState(undefined, "b1", false);
    const updated = updateBrowserTabUrlInRightPanelState(
      created,
      "b1",
      "http://localhost:3000/",
      false,
    );
    const removed = removeBrowserTabFromRightPanelState(updated, "b1", false);

    expect(created.activeEntryKey).toBe("browser:b1");
    expect(created.headerOrder).toContain("browser:b1");
    expect(updated.browserTabsById.b1?.url).toBe("http://localhost:3000/");
    expect(removed.headerOrder).not.toContain("browser:b1");
    expect(removed.browserTabsById.b1).toBeUndefined();
  });

  it("enforces the browser tab limit", () => {
    let state = reconcileRightPanelWorkspaceState(undefined, { isCloudWorkspaceSelected: false });
    for (let index = 0; index < RIGHT_PANEL_BROWSER_TAB_LIMIT; index += 1) {
      state = createBrowserTabInRightPanelState(state, `b${index}`, false);
    }

    expect(canCreateRightPanelBrowserTab(state)).toBe(false);
    expect(createBrowserTabInRightPanelState(state, "extra", false).headerOrder)
      .not.toContain("browser:extra");
  });

  it("activates an existing browser tab when the create shortcut runs at the limit", () => {
    let state = reconcileRightPanelWorkspaceState(undefined, { isCloudWorkspaceSelected: false });
    for (let index = 0; index < RIGHT_PANEL_BROWSER_TAB_LIMIT; index += 1) {
      state = createBrowserTabInRightPanelState(state, `b${index}`, false);
    }
    state = { ...state, activeEntryKey: "tool:scratch" };

    const next = createOrActivateBrowserTabInRightPanelState(state, "extra", false);

    expect(next.headerOrder).not.toContain("browser:extra");
    expect(next.activeEntryKey).toBe(`browser:b${RIGHT_PANEL_BROWSER_TAB_LIMIT - 1}`);
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

  it("clamps persisted right panel widths", () => {
    expect(clampRightPanelWidth(100)).toBe(260);
    expect(clampRightPanelWidth(900)).toBe(700);
    expect(clampRightPanelWidth(Number.NaN)).toBe(420);
  });
});
