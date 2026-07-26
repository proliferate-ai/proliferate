import { describe, expect, it } from "vitest";
import { APPEARANCE_SIZE_IDS, READABLE_CODE_FONT_SCALES } from "#product/lib/domain/preferences/appearance";
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

  it("renders the Small readable-code preset at an unscaled size with terminal row cadence", () => {
    expect(resolveXtermSurfaceTypography("small")).toEqual({
      fontSize: READABLE_CODE_FONT_SCALES.small.monacoFontSize,
      lineHeight: TERMINAL_LINE_HEIGHT,
    });
  });

  it("preserves explicit caller overrides", () => {
    const overrideFontSize = READABLE_CODE_FONT_SCALES.xxxlarge.monacoFontSize;
    expect(resolveXtermSurfaceTypography("default", { fontSize: overrideFontSize, lineHeight: 1.25 }))
      .toEqual({ fontSize: overrideFontSize, lineHeight: 1.25 });
  });
});
