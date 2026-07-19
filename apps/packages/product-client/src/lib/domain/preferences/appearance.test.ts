import { describe, expect, it } from "vitest";
import {
  APPEARANCE_SIZE_IDS,
  DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES,
  READABLE_CODE_FONT_SCALES,
  type TextTokenScale,
  resolveAppearanceSizeId,
  resolveWindowZoomId,
  stepAppearanceFontSizes,
  stepAppearanceSizeId,
  stepWindowZoomId,
  UI_FONT_SCALES,
  WINDOW_ZOOM_SCALES,
} from "#product/lib/domain/preferences/appearance";

function cssLengthToPx(value: string): number {
  if (value.endsWith("rem")) {
    return Number.parseFloat(value) * 16;
  }
  return Number.parseFloat(value);
}

const UI_FONT_SCALE_SLOTS = Object.keys(
  UI_FONT_SCALES.default,
) as (keyof typeof UI_FONT_SCALES.default)[];

function expectMonotonicTokenScale(token: keyof TextTokenScale) {
  for (let index = 1; index < APPEARANCE_SIZE_IDS.length; index += 1) {
    const previousId = APPEARANCE_SIZE_IDS[index - 1];
    const id = APPEARANCE_SIZE_IDS[index];
    if (!previousId || !id) {
      continue;
    }
    for (const slot of UI_FONT_SCALE_SLOTS) {
      expect(cssLengthToPx(UI_FONT_SCALES[id][slot][token]))
        .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId][slot][token]));
    }
  }
}

describe("appearance preferences", () => {
  it("resolves invalid size ids to default", () => {
    expect(resolveAppearanceSizeId("xxsmall")).toBe("xxsmall");
    expect(resolveAppearanceSizeId("xxxlarge")).toBe("xxxlarge");
    expect(resolveAppearanceSizeId("unknown")).toBe("default");
    expect(resolveAppearanceSizeId(undefined)).toBe("default");
  });

  it("steps appearance size ids within bounds", () => {
    expect(stepAppearanceSizeId("default", 1)).toBe("large");
    expect(stepAppearanceSizeId("default", -1)).toBe("small");
    expect(stepAppearanceSizeId("xxxlarge", 1)).toBe("xxxlarge");
    expect(stepAppearanceSizeId("xxsmall", -1)).toBe("xxsmall");
  });

  it("resolves and steps window zoom independently", () => {
    expect(resolveWindowZoomId("zoom90")).toBe("zoom90");
    expect(resolveWindowZoomId("unknown")).toBe("default");
    expect(stepWindowZoomId("default", 1)).toBe("zoom110");
    expect(stepWindowZoomId("default", -1)).toBe("zoom90");
    expect(stepWindowZoomId("zoom120", 1)).toBe("zoom120");
    expect(stepWindowZoomId("zoom80", -1)).toBe("zoom80");
    expect(WINDOW_ZOOM_SCALES.default).toEqual({ factor: 1, cssValue: "1" });
  });

  it("steps UI and readable code font sizes independently", () => {
    expect(stepAppearanceFontSizes({
      uiFontSizeId: "xxxlarge",
      readableCodeFontSizeId: "large",
    }, 1)).toEqual({
      uiFontSizeId: "xxxlarge",
      readableCodeFontSizeId: "xlarge",
    });
  });

  it("maps small to the former default and default to the former large rung", () => {
    expect(UI_FONT_SCALES.small).toMatchObject({
      base: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
      chat: { fontSize: "10px", lineHeight: "18px" },
      composer: { fontSize: "12px", lineHeight: "20px" },
      title: { fontSize: "18px", lineHeight: "22px" },
    });
    expect(UI_FONT_SCALES.default).toEqual({
      xs: { fontSize: "0.46875rem", lineHeight: "0.75rem" },
      sm: { fontSize: "0.5625rem", lineHeight: "0.9375rem" },
      base: { fontSize: "0.625rem", lineHeight: "0.9375rem" },
      uiSm: { fontSize: "11px", lineHeight: "15px" },
      ui: { fontSize: "12px", lineHeight: "17px" },
      chat: { fontSize: "11px", lineHeight: "19px" },
      composer: { fontSize: "13px", lineHeight: "21px" },
      workspaceTitle: { fontSize: "14px", lineHeight: "22px" },
      lg: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
      xl: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
      title: { fontSize: "19px", lineHeight: "23px" },
      hero: { fontSize: "26.5px", lineHeight: "34.5px" },
      sidebarNav: { fontSize: "13px", lineHeight: "18px" },
      sidebarRow: { fontSize: "13px", lineHeight: "18px" },
      sidebarBrand: { fontSize: "16px", lineHeight: "23px" },
    });
  });

  it("extends the upper rung instead of duplicating it", () => {
    expect(cssLengthToPx(UI_FONT_SCALES.xxxlarge.base.fontSize))
      .toBeGreaterThan(cssLengthToPx(UI_FONT_SCALES.xxlarge.base.fontSize));
    expect(UI_FONT_SCALES.xxxlarge.composer.fontSize).toBe("17px");
    expect(READABLE_CODE_FONT_SCALES.xxxlarge.monacoFontSize).toBe(17);
  });

  it("keeps workspace titles visibly larger than message text at every preset", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      expect(cssLengthToPx(UI_FONT_SCALES[id].workspaceTitle.fontSize))
        .toBeGreaterThan(cssLengthToPx(UI_FONT_SCALES[id].composer.fontSize));
      expect(cssLengthToPx(UI_FONT_SCALES[id].workspaceTitle.lineHeight))
        .toBeGreaterThan(cssLengthToPx(UI_FONT_SCALES[id].composer.lineHeight));
    }
  });

  it("exposes semantic glyph tiers with the approved paired-icon ratio", () => {
    expect(DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES).toEqual({
      "--icon-status": "0.45em",
      "--icon-compact": "1em",
      "--icon-paired": "1.15em",
      "--icon-control": "1.333333em",
      "--icon-large": "1.666667em",
      "--icon-display": "2em",
    });
  });

  it("keeps same-named readable code bodies aligned with visible message size", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      const messagePx = cssLengthToPx(UI_FONT_SCALES[id].composer.fontSize);
      const readable = READABLE_CODE_FONT_SCALES[id];
      expect(readable.monacoFontSize).toBe(messagePx);
      expect(cssLengthToPx(readable.diffsFontSize)).toBe(messagePx);
      expect(cssLengthToPx(readable.codeFontSize)).toBe(messagePx);
      expect(readable.monacoLineHeight).toBeGreaterThan(readable.monacoFontSize);
    }
  });

  it("keeps UI and readable-code ladders monotonic and main presets distinct", () => {
    expectMonotonicTokenScale("fontSize");
    expectMonotonicTokenScale("lineHeight");

    for (let index = 1; index < APPEARANCE_SIZE_IDS.length; index += 1) {
      const previousId = APPEARANCE_SIZE_IDS[index - 1];
      const id = APPEARANCE_SIZE_IDS[index];
      if (!previousId || !id) {
        continue;
      }
      expect(READABLE_CODE_FONT_SCALES[id].monacoFontSize)
        .toBeGreaterThanOrEqual(READABLE_CODE_FONT_SCALES[previousId].monacoFontSize);
      expect(READABLE_CODE_FONT_SCALES[id].monacoLineHeight)
        .toBeGreaterThanOrEqual(READABLE_CODE_FONT_SCALES[previousId].monacoLineHeight);
    }

    expect(cssLengthToPx(UI_FONT_SCALES.small.base.fontSize))
      .toBeLessThan(cssLengthToPx(UI_FONT_SCALES.default.base.fontSize));
    expect(cssLengthToPx(UI_FONT_SCALES.default.base.fontSize))
      .toBeLessThan(cssLengthToPx(UI_FONT_SCALES.large.base.fontSize));
  });

  it("uses the readable chat line-height ladder and preserves a usable lower bound", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      expect(cssLengthToPx(UI_FONT_SCALES[id].chat.lineHeight))
        .toBe(cssLengthToPx(UI_FONT_SCALES[id].composer.fontSize) + 6);
    }
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.base.fontSize)).toBe(8);
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.chat.fontSize)).toBe(9);
    expect(READABLE_CODE_FONT_SCALES.xxsmall.monacoFontSize).toBe(11);
  });
});
