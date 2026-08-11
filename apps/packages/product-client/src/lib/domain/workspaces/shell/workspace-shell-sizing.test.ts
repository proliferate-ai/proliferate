import { describe, expect, it } from "vitest";
import {
  WORKSPACE_MAIN_MIN_WIDTH,
  resolveWorkspaceShellSizing,
} from "#product/lib/domain/workspaces/shell/workspace-shell-sizing";

describe("resolveWorkspaceShellSizing", () => {
  it("reserves the main pane and sheds right-rail excess first in passive layout", () => {
    expect(resolveWorkspaceShellSizing({
      containerWidth: 1083,
      leftWidth: 420,
      rightWidth: 480,
    })).toEqual({ left: 283, right: 380 });

    expect(resolveWorkspaceShellSizing({
      containerWidth: 1024,
      leftWidth: 420,
      rightWidth: 480,
    })).toEqual({ left: 224, right: 380 });
  });

  it("restores both requested widths when the container has room again", () => {
    expect(resolveWorkspaceShellSizing({
      containerWidth: 1320,
      leftWidth: 420,
      rightWidth: 480,
    })).toEqual({ left: 420, right: 480 });
  });

  it("gives a live right-edge drag precedence over left-rail excess", () => {
    expect(resolveWorkspaceShellSizing({
      containerWidth: 1083,
      leftWidth: 420,
      rightWidth: 400,
      priority: "right",
    })).toEqual({ left: 263, right: 400 });
  });

  it("compresses open rail minima proportionally below the normal desktop envelope", () => {
    const sizing = resolveWorkspaceShellSizing({
      containerWidth: 900,
      leftWidth: 420,
      rightWidth: 480,
    });

    expect(sizing).toEqual({ left: 176, right: 304 });
    expect(900 - sizing.left - sizing.right).toBe(WORKSPACE_MAIN_MIN_WIDTH);
  });

  it("gives all available side budget to the only open rail", () => {
    expect(resolveWorkspaceShellSizing({
      containerWidth: 600,
      leftWidth: 420,
      rightWidth: 0,
    })).toEqual({ left: 180, right: 0 });
  });

  it("preserves requested geometry until a real container width is known", () => {
    expect(resolveWorkspaceShellSizing({
      containerWidth: null,
      leftWidth: 420,
      rightWidth: 480,
    })).toEqual({ left: 420, right: 480 });
  });
});
