// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { getResolvedMode, getTerminalTheme } from "#product/config/theme";

afterEach(() => {
  delete document.documentElement.dataset.mode;
  document.documentElement.style.removeProperty("--color-text-caret");
  document.documentElement.style.removeProperty("--color-text-selection");
  document.documentElement.style.removeProperty("--color-foreground");
  document.documentElement.style.removeProperty("--color-input");
});

describe("getResolvedMode", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "dark"],
    ["invalid", "dark"],
  ] as const)("resolves %s to %s", (mode, resolved) => {
    document.documentElement.dataset.mode = mode;

    expect(getResolvedMode()).toBe(resolved);
  });
});

describe("getTerminalTheme", () => {
  it("consumes the shared semantic caret and selection roles", () => {
    const root = document.documentElement;
    root.style.setProperty("--color-text-caret", "rgb(1, 2, 3)");
    root.style.setProperty("--color-text-selection", "rgba(4, 5, 6, 0.5)");

    expect(getTerminalTheme()).toMatchObject({
      cursor: "rgb(1, 2, 3)",
      selectionBackground: "rgba(4, 5, 6, 0.5)",
    });
  });

  it("keeps safe legacy fallbacks when semantic roles are absent", () => {
    const root = document.documentElement;
    root.style.setProperty("--color-foreground", "rgb(7, 8, 9)");
    root.style.setProperty("--color-input", "rgba(10, 11, 12, 0.4)");

    expect(getTerminalTheme()).toMatchObject({
      cursor: "rgb(7, 8, 9)",
      selectionBackground: "rgba(10, 11, 12, 0.4)",
    });
  });
});
