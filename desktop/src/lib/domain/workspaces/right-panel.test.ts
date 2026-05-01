import { describe, expect, it } from "vitest";
import {
  RIGHT_PANEL_BROWSER_TAB_LIMIT,
  availableRightPanelTools,
  canCreateRightPanelBrowserTab,
  clampRightPanelWidth,
  createBrowserTabInRightPanelState,
  parseRightPanelHeaderEntryKey,
  reconcileRightPanelWorkspaceState,
  removeBrowserTabFromRightPanelState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  reorderTerminalInRightPanelState,
  reorderToolInRightPanelState,
  updateBrowserTabUrlInRightPanelState,
} from "./right-panel";

describe("right panel domain", () => {
  it("gates cloud settings to cloud workspaces", () => {
    expect(availableRightPanelTools(false)).toEqual(["files", "git"]);
    expect(availableRightPanelTools(true)).toEqual(["files", "git", "settings"]);
  });

  it("parses browser entry keys", () => {
    expect(parseRightPanelHeaderEntryKey("browser:b1")).toEqual({
      kind: "browser",
      browserId: "b1",
    });
  });

  it("drops cloud settings for local workspaces and falls back to git", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "tool:settings",
        headerOrder: ["tool:settings", "tool:files"],
      },
      { isCloudWorkspaceSelected: false },
    );

    expect(state.activeEntryKey).toBe("tool:git");
    expect(state.headerOrder).toEqual(["tool:files", "tool:git"]);
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
    expect(state.headerOrder).toEqual(["terminal:t1", "tool:git", "tool:files"]);
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

    expect(state.headerOrder).toEqual(["tool:git", "terminal:t2", "tool:files", "terminal:t1"]);
    expect(state.activeEntryKey).toBe("tool:git");
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

    expect(state.headerOrder).toEqual(["tool:git", "tool:files", "terminal:run"]);
  });

  it("reconciles one mixed header order for tools, terminals, and browsers", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeEntryKey: "browser:b1",
        headerOrder: ["browser:b1", "terminal:t2", "tool:git", "tool:files"],
        browserTabsById: {
          b1: { id: "b1", url: null },
        },
      },
      {
        isCloudWorkspaceSelected: false,
        liveTerminals: [{ id: "t1" }, { id: "t2" }],
      },
    );

    expect(state.headerOrder).toEqual([
      "browser:b1",
      "terminal:t2",
      "tool:git",
      "tool:files",
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

    expect(state.headerOrder).toEqual(["tool:git", "terminal:t1", "terminal:t3", "tool:files"]);
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

    expect(state.headerOrder).toEqual(["terminal:t3", "terminal:t1", "terminal:t2", "tool:files", "tool:git"]);
    expect(state.activeEntryKey).toBe("terminal:t1");
  });

  it("reorders tools and terminals across the same header", () => {
    const state = reorderHeaderEntryInRightPanelState(
      {
        activeEntryKey: "tool:git",
        headerOrder: ["tool:files", "terminal:t1", "tool:git", "terminal:t2"],
      },
      "terminal:t2",
      "tool:files",
      false,
    );

    expect(state.headerOrder).toEqual([
      "terminal:t2",
      "tool:files",
      "terminal:t1",
      "tool:git",
    ]);
  });

  it("reorders singleton tools via the shared header order", () => {
    const state = reorderToolInRightPanelState(
      {
        activeEntryKey: "tool:git",
        headerOrder: ["tool:files", "tool:git", "tool:settings"],
      },
      "settings",
      "files",
      true,
    );

    expect(state.headerOrder).toEqual(["tool:settings", "tool:files", "tool:git"]);
    expect(state.activeEntryKey).toBe("tool:git");
  });

  it("clamps persisted right panel widths", () => {
    expect(clampRightPanelWidth(100)).toBe(260);
    expect(clampRightPanelWidth(900)).toBe(700);
    expect(clampRightPanelWidth(Number.NaN)).toBe(420);
  });
});
