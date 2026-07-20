import { describe, expect, it } from "vitest";
import { APPEARANCE_SIZE_IDS } from "#product/lib/domain/preferences/appearance";
import { TERMINAL_LINE_HEIGHT } from "#product/lib/domain/terminals/terminal-grid";
import {
  resolveXtermSurfaceTypography,
  XTERM_CURSOR_OPTIONS,
} from "#product/hooks/terminals/lifecycle/use-xterm-surface";

describe("xterm cursor contract", () => {
  it("uses the same one-pixel bar geometry as composed text editors", () => {
    expect(XTERM_CURSOR_OPTIONS).toEqual({
      cursorStyle: "bar",
      cursorWidth: 1,
    });
  });
});

describe("resolveXtermSurfaceTypography", () => {
  it.each(APPEARANCE_SIZE_IDS)("derives readable-code terminal geometry for %s", (sizeId) => {
    const typography = resolveXtermSurfaceTypography(sizeId);

    expect(typography.fontSize).toBeGreaterThan(0);
    expect(typography.lineHeight).toBe(TERMINAL_LINE_HEIGHT);
    expect(typography.fontSize * typography.lineHeight).toBeGreaterThan(typography.fontSize);
  });

  it("renders the Small readable-code preset at an unscaled 12px with terminal row cadence", () => {
    expect(resolveXtermSurfaceTypography("small")).toEqual({
      fontSize: 12,
      lineHeight: 1.2,
    });
  });

  it("preserves explicit caller overrides", () => {
    expect(resolveXtermSurfaceTypography("default", { fontSize: 20, lineHeight: 1.25 }))
      .toEqual({ fontSize: 20, lineHeight: 1.25 });
  });
});
