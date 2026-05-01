import { describe, expect, it } from "vitest";
import {
  availableRightPanelTools,
  clampRightPanelWidth,
  mergeTerminalOrder,
  reconcileRightPanelWorkspaceState,
  removeTerminalFromRightPanelState,
  reorderHeaderEntryInRightPanelState,
  reorderTerminalInRightPanelState,
  reorderToolInRightPanelState,
} from "./right-panel";

describe("right panel domain", () => {
  it("gates cloud settings to cloud workspaces", () => {
    expect(availableRightPanelTools(false)).toEqual(["files", "git"]);
    expect(availableRightPanelTools(true)).toEqual(["files", "git", "settings"]);
  });

  it("falls back to git when the active tool is no longer valid", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeTool: "settings",
        toolOrder: ["settings", "terminal"],
      },
      { isCloudWorkspaceSelected: false },
    );

    expect(state.activeTool).toBe("git");
    expect(state.toolOrder).toEqual(["files", "git"]);
  });

  it("keeps a terminal active when it points at a live terminal entry", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        activeTool: "terminal",
        terminalOrder: ["t1"],
        activeTerminalId: "t1",
      },
      { isCloudWorkspaceSelected: false },
    );

    expect(state.activeTool).toBe("terminal");
    expect(state.activeTerminalId).toBe("t1");
  });

  it("merges terminal order by preserving known ids and appending discovered ids", () => {
    expect(mergeTerminalOrder(["t2", "stale", "t1"], ["t1", "t2", "t3"])).toEqual([
      "t2",
      "t1",
      "t3",
    ]);
  });

  it("does not prune terminal ids when no live list is available", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        terminalOrder: ["stale", "t1"],
        activeTerminalId: "stale",
      },
      { isCloudWorkspaceSelected: false },
    );

    expect(state.terminalOrder).toEqual(["stale", "t1"]);
    expect(state.activeTerminalId).toBe("stale");
  });

  it("prunes stale terminal ids against a successful live list", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        terminalOrder: ["stale", "t2"],
        headerOrder: ["terminal:stale", "tool:git", "terminal:t2"],
        activeTerminalId: "stale",
      },
      {
        isCloudWorkspaceSelected: false,
        liveTerminalIds: ["t1", "t2"],
      },
    );

    expect(state.terminalOrder).toEqual(["t2", "t1"]);
    expect(state.headerOrder).toEqual(["tool:git", "terminal:t2", "tool:files", "terminal:t1"]);
    expect(state.activeTerminalId).toBe("t2");
  });

  it("reconciles one mixed header order for tools and terminal tabs", () => {
    const state = reconcileRightPanelWorkspaceState(
      {
        toolOrder: ["files", "git"],
        terminalOrder: ["t1", "t2", "t3"],
        headerOrder: ["terminal:t2", "tool:git", "terminal:t1", "tool:files"],
      },
      {
        isCloudWorkspaceSelected: false,
        liveTerminalIds: ["t1", "t2", "t3"],
      },
    );

    expect(state.headerOrder).toEqual([
      "terminal:t2",
      "tool:git",
      "terminal:t1",
      "tool:files",
      "terminal:t3",
    ]);
    expect(state.toolOrder).toEqual(["git", "files"]);
    expect(state.terminalOrder).toEqual(["t2", "t1", "t3"]);
  });

  it("removes a closed terminal and falls back to the nearest remaining terminal", () => {
    const state = removeTerminalFromRightPanelState(
      {
        terminalOrder: ["t1", "t2", "t3"],
        activeTerminalId: "t2",
      },
      "t2",
      false,
    );

    expect(state.terminalOrder).toEqual(["t1", "t3"]);
    expect(state.activeTerminalId).toBe("t1");
  });

  it("reorders terminal ids immediately", () => {
    const state = reorderTerminalInRightPanelState(
      {
        terminalOrder: ["t1", "t2", "t3"],
        activeTerminalId: "t1",
      },
      "t3",
      "t1",
      false,
    );

    expect(state.terminalOrder).toEqual(["t3", "t1", "t2"]);
    expect(state.activeTerminalId).toBe("t1");
  });

  it("reorders tools and terminals across the same header", () => {
    const state = reorderHeaderEntryInRightPanelState(
      {
        toolOrder: ["files", "git"],
        terminalOrder: ["t1", "t2"],
        headerOrder: ["tool:files", "terminal:t1", "tool:git", "terminal:t2"],
        activeTool: "git",
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
    expect(state.toolOrder).toEqual(["files", "git"]);
    expect(state.terminalOrder).toEqual(["t2", "t1"]);
  });

  it("reorders right panel tools immediately", () => {
    const state = reorderToolInRightPanelState(
      {
        toolOrder: ["files", "git", "settings"],
        activeTool: "git",
      },
      "settings",
      "files",
      true,
    );

    expect(state.toolOrder).toEqual(["settings", "files", "git"]);
    expect(state.activeTool).toBe("git");
  });

  it("does not allow the terminal group sentinel into the tool order", () => {
    const state = reorderToolInRightPanelState(
      {
        toolOrder: ["files", "git"],
      },
      "terminal",
      "files",
      false,
    );

    expect(state.toolOrder).toEqual(["files", "git"]);
  });

  it("clamps persisted right panel widths", () => {
    expect(clampRightPanelWidth(100)).toBe(260);
    expect(clampRightPanelWidth(900)).toBe(700);
    expect(clampRightPanelWidth(Number.NaN)).toBe(420);
  });
});
