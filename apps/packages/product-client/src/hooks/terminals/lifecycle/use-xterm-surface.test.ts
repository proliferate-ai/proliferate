import { describe, expect, it } from "vitest";
import { APPEARANCE_SIZE_IDS } from "#product/lib/domain/preferences/appearance";
import { resolveXtermSurfaceTypography } from "#product/hooks/terminals/lifecycle/use-xterm-surface";

describe("resolveXtermSurfaceTypography", () => {
  it.each(APPEARANCE_SIZE_IDS)("derives readable-code terminal geometry for %s", (sizeId) => {
    const typography = resolveXtermSurfaceTypography(sizeId);

    expect(typography.fontSize).toBeGreaterThan(0);
    expect(typography.lineHeight).toBeGreaterThan(1);
    expect(typography.fontSize * typography.lineHeight).toBeGreaterThan(typography.fontSize);
  });

  it("preserves explicit caller overrides", () => {
    expect(resolveXtermSurfaceTypography("default", { fontSize: 20, lineHeight: 1.25 }))
      .toEqual({ fontSize: 20, lineHeight: 1.25 });
  });
});
