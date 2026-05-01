import { describe, expect, it } from "vitest";
import {
  APPEARANCE_SIZE_IDS,
  CHAT_LINE_HEIGHTS,
  READABLE_CODE_FONT_SCALES,
  resolveAppearanceSizeId,
  UI_FONT_SCALES,
} from "./appearance";

describe("appearance preferences", () => {
  it("resolves invalid size ids to default", () => {
    expect(resolveAppearanceSizeId("xsmall")).toBe("xsmall");
    expect(resolveAppearanceSizeId("small")).toBe("small");
    expect(resolveAppearanceSizeId("xxlarge")).toBe("xxlarge");
    expect(resolveAppearanceSizeId("unknown")).toBe("default");
    expect(resolveAppearanceSizeId(undefined)).toBe("default");
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

  it("defines exact readable code preset values", () => {
    expect(READABLE_CODE_FONT_SCALES).toEqual({
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
    });
  });

  it("keeps diff code one step smaller than matching chat text", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      const chatPx = Number.parseFloat(UI_FONT_SCALES[id].chat.fontSize);
      const diffPx = Number.parseFloat(READABLE_CODE_FONT_SCALES[id].diffsFontSize);
      expect(diffPx).toBeLessThan(chatPx);
    }
  });
});
