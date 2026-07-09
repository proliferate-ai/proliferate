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
      xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
      sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
      base: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
      uiSm: { fontSize: "10px", lineHeight: "14px" },
      ui: { fontSize: "11px", lineHeight: "16px" },
      chat: { fontSize: "10px", lineHeight: "18px" },
      composer: { fontSize: "12px", lineHeight: "20px" },
      lg: { fontSize: "0.75rem", lineHeight: "1.125rem" },
      xl: { fontSize: "1rem", lineHeight: "1.5rem" },
      title: { fontSize: "18px", lineHeight: "22px" },
      hero: { fontSize: "25px", lineHeight: "33px" },
    });
  });

  it("defines exact UI font preset values", () => {
    expect(UI_FONT_SCALES).toEqual({
      xxsmall: {
        xs: { fontSize: "0.375rem", lineHeight: "0.6875rem" },
        sm: { fontSize: "0.4375rem", lineHeight: "0.8125rem" },
        base: { fontSize: "0.46875rem", lineHeight: "0.78125rem" },
        uiSm: { fontSize: "8.5px", lineHeight: "12.5px" },
        ui: { fontSize: "9.5px", lineHeight: "14.5px" },
        chat: { fontSize: "8.5px", lineHeight: "16.5px" },
        composer: { fontSize: "10.5px", lineHeight: "18.5px" },
        lg: { fontSize: "0.65625rem", lineHeight: "1.03125rem" },
        xl: { fontSize: "0.90625rem", lineHeight: "1.3125rem" },
        title: { fontSize: "15px", lineHeight: "19px" },
        hero: { fontSize: "22px", lineHeight: "30px" },
      },
      xsmall: {
        xs: { fontSize: "0.40625rem", lineHeight: "0.6875rem" },
        sm: { fontSize: "0.46875rem", lineHeight: "0.8125rem" },
        base: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
        uiSm: { fontSize: "9px", lineHeight: "13px" },
        ui: { fontSize: "10px", lineHeight: "15px" },
        chat: { fontSize: "9px", lineHeight: "17px" },
        composer: { fontSize: "11px", lineHeight: "19px" },
        lg: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
        xl: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
        title: { fontSize: "16px", lineHeight: "20px" },
        hero: { fontSize: "23px", lineHeight: "31px" },
      },
      small: {
        xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
        sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
        base: { fontSize: "0.53125rem", lineHeight: "0.84375rem" },
        uiSm: { fontSize: "9.5px", lineHeight: "13.5px" },
        ui: { fontSize: "10.5px", lineHeight: "15.5px" },
        chat: { fontSize: "9.5px", lineHeight: "17.5px" },
        composer: { fontSize: "11.5px", lineHeight: "19.5px" },
        lg: { fontSize: "0.71875rem", lineHeight: "1.09375rem" },
        xl: { fontSize: "0.96875rem", lineHeight: "1.4375rem" },
        title: { fontSize: "17px", lineHeight: "21px" },
        hero: { fontSize: "24px", lineHeight: "32px" },
      },
      default: {
        xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
        sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
        base: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
        uiSm: { fontSize: "10px", lineHeight: "14px" },
        ui: { fontSize: "11px", lineHeight: "16px" },
        chat: { fontSize: "10px", lineHeight: "18px" },
        composer: { fontSize: "12px", lineHeight: "20px" },
        lg: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        xl: { fontSize: "1rem", lineHeight: "1.5rem" },
        title: { fontSize: "18px", lineHeight: "22px" },
        hero: { fontSize: "25px", lineHeight: "33px" },
      },
      large: {
        xs: { fontSize: "0.46875rem", lineHeight: "0.75rem" },
        sm: { fontSize: "0.5625rem", lineHeight: "0.9375rem" },
        base: { fontSize: "0.625rem", lineHeight: "0.9375rem" },
        uiSm: { fontSize: "11px", lineHeight: "15px" },
        ui: { fontSize: "12px", lineHeight: "17px" },
        chat: { fontSize: "11px", lineHeight: "19px" },
        composer: { fontSize: "13px", lineHeight: "21px" },
        lg: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
        xl: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
        title: { fontSize: "19px", lineHeight: "23px" },
        hero: { fontSize: "26.5px", lineHeight: "34.5px" },
      },
      xlarge: {
        xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
        sm: { fontSize: "0.625rem", lineHeight: "1rem" },
        base: { fontSize: "0.6875rem", lineHeight: "1rem" },
        uiSm: { fontSize: "12px", lineHeight: "16px" },
        ui: { fontSize: "13px", lineHeight: "18px" },
        chat: { fontSize: "12px", lineHeight: "20px" },
        composer: { fontSize: "14px", lineHeight: "22px" },
        lg: { fontSize: "0.875rem", lineHeight: "1.25rem" },
        xl: { fontSize: "1.125rem", lineHeight: "1.75rem" },
        title: { fontSize: "20px", lineHeight: "24px" },
        hero: { fontSize: "28px", lineHeight: "36px" },
      },
      xxlarge: {
        xs: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
        sm: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
        base: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        uiSm: { fontSize: "13px", lineHeight: "17px" },
        ui: { fontSize: "14px", lineHeight: "19px" },
        chat: { fontSize: "13px", lineHeight: "21px" },
        composer: { fontSize: "15px", lineHeight: "23px" },
        lg: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
        xl: { fontSize: "1.1875rem", lineHeight: "1.875rem" },
        title: { fontSize: "21px", lineHeight: "25px" },
        hero: { fontSize: "29.5px", lineHeight: "37.5px" },
      },
      xxxlarge: {
        xs: { fontSize: "0.625rem", lineHeight: "1rem" },
        sm: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        base: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
        uiSm: { fontSize: "14px", lineHeight: "18px" },
        ui: { fontSize: "15px", lineHeight: "20px" },
        chat: { fontSize: "14px", lineHeight: "22px" },
        composer: { fontSize: "16px", lineHeight: "24px" },
        lg: { fontSize: "1rem", lineHeight: "1.5rem" },
        xl: { fontSize: "1.25rem", lineHeight: "2rem" },
        title: { fontSize: "22px", lineHeight: "26px" },
        hero: { fontSize: "31px", lineHeight: "39px" },
      },
    });
  });

  it("preserves current default readable code values", () => {
    expect(READABLE_CODE_FONT_SCALES.default).toEqual({
      monacoFontSize: 9,
      monacoLineHeight: 16,
      diffsFontSize: "9px",
      diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
      codeFontSize: "0.5625rem",
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
        monacoFontSize: 7.5,
        monacoLineHeight: 14,
        diffsFontSize: "7.5px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.46875rem",
        codeLineHeight: "1.625",
      },
      xsmall: {
        monacoFontSize: 8,
        monacoLineHeight: 14.5,
        diffsFontSize: "8px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.5rem",
        codeLineHeight: "1.625",
      },
      small: {
        monacoFontSize: 8.5,
        monacoLineHeight: 15.5,
        diffsFontSize: "8.5px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.53125rem",
        codeLineHeight: "1.625",
      },
      default: {
        monacoFontSize: 9,
        monacoLineHeight: 16,
        diffsFontSize: "9px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.5625rem",
        codeLineHeight: "1.625",
      },
      large: {
        monacoFontSize: 10,
        monacoLineHeight: 17,
        diffsFontSize: "10px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.625rem",
        codeLineHeight: "1.625",
      },
      xlarge: {
        monacoFontSize: 11,
        monacoLineHeight: 18,
        diffsFontSize: "11px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.6875rem",
        codeLineHeight: "1.625",
      },
      xxlarge: {
        monacoFontSize: 12,
        monacoLineHeight: 20,
        diffsFontSize: "12px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.75rem",
        codeLineHeight: "1.625",
      },
      xxxlarge: {
        monacoFontSize: 13,
        monacoLineHeight: 21,
        diffsFontSize: "13px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.8125rem",
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
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.xs.fontSize)).toBe(6);
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.sm.fontSize)).toBe(7);
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.base.fontSize)).toBeGreaterThanOrEqual(7.5);
    expect(cssLengthToPx(UI_FONT_SCALES.xxsmall.chat.fontSize)).toBeGreaterThanOrEqual(8.5);
    expect(READABLE_CODE_FONT_SCALES.xxsmall.monacoFontSize).toBeGreaterThanOrEqual(7.5);
    expect(cssLengthToPx(READABLE_CODE_FONT_SCALES.xxsmall.diffsFontSize))
      .toBeGreaterThanOrEqual(7.5);
    expect(cssLengthToPx(READABLE_CODE_FONT_SCALES.xxsmall.codeFontSize))
      .toBeGreaterThanOrEqual(7.5);
  });
});
