import { describe, expect, it } from "vitest";
import {
  APPEARANCE_SIZE_IDS,
  CHAT_LINE_HEIGHTS,
  READABLE_CODE_FONT_SCALES,
  type TextTokenScale,
  resolveAppearanceSizeId,
  resolveWindowZoomId,
  stepAppearanceFontSizes,
  stepAppearanceSizeId,
  stepWindowZoomId,
  UI_FONT_SCALES,
  WINDOW_ZOOM_SCALES,
} from "./appearance";

function cssLengthToPx(value: string): number {
  if (value.endsWith("rem")) {
    return Number.parseFloat(value) * 16;
  }
  if (value.endsWith("px")) {
    return Number.parseFloat(value);
  }
  return Number.parseFloat(value);
}

function expectMonotonicTokenScale(token: keyof TextTokenScale) {
  for (let index = 1; index < APPEARANCE_SIZE_IDS.length; index += 1) {
    const previousId = APPEARANCE_SIZE_IDS[index - 1];
    const id = APPEARANCE_SIZE_IDS[index];
    if (!previousId || !id) {
      continue;
    }
    expect(cssLengthToPx(UI_FONT_SCALES[id].xs[token]))
      .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId].xs[token]));
    expect(cssLengthToPx(UI_FONT_SCALES[id].sm[token]))
      .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId].sm[token]));
    expect(cssLengthToPx(UI_FONT_SCALES[id].base[token]))
      .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId].base[token]));
    expect(cssLengthToPx(UI_FONT_SCALES[id].chat[token]))
      .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId].chat[token]));
    expect(cssLengthToPx(UI_FONT_SCALES[id].lg[token]))
      .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId].lg[token]));
    expect(cssLengthToPx(UI_FONT_SCALES[id].xl[token]))
      .toBeGreaterThanOrEqual(cssLengthToPx(UI_FONT_SCALES[previousId].xl[token]));
  }
}

describe("appearance preferences", () => {
  it("resolves invalid size ids to default", () => {
    expect(resolveAppearanceSizeId("xxsmall")).toBe("xxsmall");
    expect(resolveAppearanceSizeId("xsmall")).toBe("xsmall");
    expect(resolveAppearanceSizeId("small")).toBe("small");
    expect(resolveAppearanceSizeId("xxlarge")).toBe("xxlarge");
    expect(resolveAppearanceSizeId("xxxlarge")).toBe("xxxlarge");
    expect(resolveAppearanceSizeId("unknown")).toBe("default");
    expect(resolveAppearanceSizeId(undefined)).toBe("default");
  });

  it("steps appearance size ids within bounds", () => {
    expect(stepAppearanceSizeId("default", 1)).toBe("large");
    expect(stepAppearanceSizeId("default", -1)).toBe("small");
    expect(stepAppearanceSizeId("xxlarge", 1)).toBe("xxxlarge");
    expect(stepAppearanceSizeId("xxxlarge", 1)).toBe("xxxlarge");
    expect(stepAppearanceSizeId("xsmall", -1)).toBe("xxsmall");
    expect(stepAppearanceSizeId("xxsmall", -1)).toBe("xxsmall");
  });

  it("resolves invalid window zoom ids to default", () => {
    expect(resolveWindowZoomId("zoom90")).toBe("zoom90");
    expect(resolveWindowZoomId("zoom120")).toBe("zoom120");
    expect(resolveWindowZoomId("unknown")).toBe("default");
    expect(resolveWindowZoomId(undefined)).toBe("default");
  });

  it("steps window zoom ids within bounds", () => {
    expect(stepWindowZoomId("default", 1)).toBe("zoom110");
    expect(stepWindowZoomId("default", -1)).toBe("zoom90");
    expect(stepWindowZoomId("zoom110", 1)).toBe("zoom120");
    expect(stepWindowZoomId("zoom120", 1)).toBe("zoom120");
    expect(stepWindowZoomId("zoom90", -1)).toBe("zoom80");
    expect(stepWindowZoomId("zoom80", -1)).toBe("zoom80");
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

  it("uses exact Codex chat line-height presets", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      expect(UI_FONT_SCALES[id].chat.lineHeight).toBe(CHAT_LINE_HEIGHTS[id]);
    }
  });

  it("preserves current default UI token values", () => {
    expect(UI_FONT_SCALES.default).toEqual({
      xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
      sm: { fontSize: "0.625rem", lineHeight: "1rem" },
      base: { fontSize: "0.6875rem", lineHeight: "1rem" },
      chat: { fontSize: "12px", lineHeight: "20px" },
      lg: { fontSize: "0.875rem", lineHeight: "1.25rem" },
      xl: { fontSize: "1.125rem", lineHeight: "1.75rem" },
    });
  });

  it("defines exact UI font preset values", () => {
    expect(UI_FONT_SCALES).toEqual({
      xxsmall: {
        xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
        sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
        base: { fontSize: "0.53125rem", lineHeight: "0.84375rem" },
        chat: { fontSize: "9.5px", lineHeight: "17.5px" },
        lg: { fontSize: "0.71875rem", lineHeight: "1.09375rem" },
        xl: { fontSize: "0.96875rem", lineHeight: "1.4375rem" },
      },
      xsmall: {
        xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
        sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
        base: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
        chat: { fontSize: "10px", lineHeight: "18px" },
        lg: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        xl: { fontSize: "1rem", lineHeight: "1.5rem" },
      },
      small: {
        xs: { fontSize: "0.46875rem", lineHeight: "0.75rem" },
        sm: { fontSize: "0.5625rem", lineHeight: "0.9375rem" },
        base: { fontSize: "0.625rem", lineHeight: "0.9375rem" },
        chat: { fontSize: "11px", lineHeight: "19px" },
        lg: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
        xl: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
      },
      default: {
        xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
        sm: { fontSize: "0.625rem", lineHeight: "1rem" },
        base: { fontSize: "0.6875rem", lineHeight: "1rem" },
        chat: { fontSize: "12px", lineHeight: "20px" },
        lg: { fontSize: "0.875rem", lineHeight: "1.25rem" },
        xl: { fontSize: "1.125rem", lineHeight: "1.75rem" },
      },
      large: {
        xs: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
        sm: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
        base: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        chat: { fontSize: "13px", lineHeight: "21px" },
        lg: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
        xl: { fontSize: "1.1875rem", lineHeight: "1.875rem" },
      },
      xlarge: {
        xs: { fontSize: "0.625rem", lineHeight: "1rem" },
        sm: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        base: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
        chat: { fontSize: "14px", lineHeight: "22px" },
        lg: { fontSize: "1rem", lineHeight: "1.5rem" },
        xl: { fontSize: "1.25rem", lineHeight: "2rem" },
      },
      xxlarge: {
        xs: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
        sm: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
        base: { fontSize: "0.875rem", lineHeight: "1.375rem" },
        chat: { fontSize: "15px", lineHeight: "23px" },
        lg: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
        xl: { fontSize: "1.3125rem", lineHeight: "2.125rem" },
      },
      xxxlarge: {
        xs: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        sm: { fontSize: "0.875rem", lineHeight: "1.3125rem" },
        base: { fontSize: "0.9375rem", lineHeight: "1.5rem" },
        chat: { fontSize: "16px", lineHeight: "24px" },
        lg: { fontSize: "1.125rem", lineHeight: "1.75rem" },
        xl: { fontSize: "1.375rem", lineHeight: "2.25rem" },
      },
    });
  });

  it("preserves current default readable code values", () => {
    expect(READABLE_CODE_FONT_SCALES.default).toEqual({
      monacoFontSize: 11,
      monacoLineHeight: 18,
      diffsFontSize: "11px",
      diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
      codeFontSize: "0.6875rem",
      codeLineHeight: "1.625",
    });
  });

  it("defines window zoom values separately from font scales", () => {
    expect(WINDOW_ZOOM_SCALES).toEqual({
      zoom80: { factor: 0.8, cssValue: "0.8" },
      zoom90: { factor: 0.9, cssValue: "0.9" },
      default: { factor: 1, cssValue: "1" },
      zoom110: { factor: 1.1, cssValue: "1.1" },
      zoom120: { factor: 1.2, cssValue: "1.2" },
    });
  });

  it("defines exact readable code preset values", () => {
    expect(READABLE_CODE_FONT_SCALES).toEqual({
      xxsmall: {
        monacoFontSize: 8.5,
        monacoLineHeight: 15.5,
        diffsFontSize: "8.5px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.53125rem",
        codeLineHeight: "1.625",
      },
      xsmall: {
        monacoFontSize: 9,
        monacoLineHeight: 16,
        diffsFontSize: "9px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.5625rem",
        codeLineHeight: "1.625",
      },
      small: {
        monacoFontSize: 10,
        monacoLineHeight: 17,
        diffsFontSize: "10px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.625rem",
        codeLineHeight: "1.625",
      },
      default: {
        monacoFontSize: 11,
        monacoLineHeight: 18,
        diffsFontSize: "11px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.6875rem",
        codeLineHeight: "1.625",
      },
      large: {
        monacoFontSize: 12,
        monacoLineHeight: 20,
        diffsFontSize: "12px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.75rem",
        codeLineHeight: "1.625",
      },
      xlarge: {
        monacoFontSize: 13,
        monacoLineHeight: 21,
        diffsFontSize: "13px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.8125rem",
        codeLineHeight: "1.625",
      },
      xxlarge: {
        monacoFontSize: 14,
        monacoLineHeight: 23,
        diffsFontSize: "14px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.875rem",
        codeLineHeight: "1.625",
      },
      xxxlarge: {
        monacoFontSize: 15,
        monacoLineHeight: 24,
        diffsFontSize: "15px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.9375rem",
        codeLineHeight: "1.625",
      },
    });
  });

  it("keeps diff code one step smaller than matching chat text", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      const chatPx = Number.parseFloat(UI_FONT_SCALES[id].chat.fontSize);
      const diffPx = Number.parseFloat(READABLE_CODE_FONT_SCALES[id].diffsFontSize);
      expect(diffPx).toBeLessThan(chatPx);
    }
  });

  it("keeps appearance scales monotonic", () => {
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
      expect(cssLengthToPx(READABLE_CODE_FONT_SCALES[id].diffsFontSize))
        .toBeGreaterThanOrEqual(cssLengthToPx(READABLE_CODE_FONT_SCALES[previousId].diffsFontSize));
      expect(cssLengthToPx(READABLE_CODE_FONT_SCALES[id].codeFontSize))
        .toBeGreaterThanOrEqual(cssLengthToPx(READABLE_CODE_FONT_SCALES[previousId].codeFontSize));
    }
  });

  it("keeps the new lower bound close to the previous smallest size", () => {
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.xs.fontSize)).toBe(7);
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.sm.fontSize)).toBe(8);
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.base.fontSize)).toBeGreaterThanOrEqual(8.5);
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.chat.fontSize)).toBeGreaterThanOrEqual(9.5);
    expect(READABLE_CODE_FONT_SCALES.xxsmall.monacoFontSize).toBeGreaterThanOrEqual(8.5);
    expect(cssLengthToPx(READABLE_CODE_FONT_SCALES.xxsmall.diffsFontSize))
      .toBeGreaterThanOrEqual(8.5);
    expect(cssLengthToPx(READABLE_CODE_FONT_SCALES.xxsmall.codeFontSize))
      .toBeGreaterThanOrEqual(8.5);
  });
});
