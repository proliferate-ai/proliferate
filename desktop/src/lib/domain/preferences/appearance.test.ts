import { describe, expect, it } from "vitest";
import {
  APPEARANCE_SIZE_IDS,
  CHAT_LINE_HEIGHT_REM,
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

  it("keeps chat line-height fixed across UI font scales", () => {
    for (const id of APPEARANCE_SIZE_IDS) {
      expect(UI_FONT_SCALES[id].chat.lineHeight).toBe(CHAT_LINE_HEIGHT_REM);
    }
  });

  it("preserves current default UI token values", () => {
    expect(UI_FONT_SCALES.default).toEqual({
      xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
      sm: { fontSize: "0.625rem", lineHeight: "1rem" },
      base: { fontSize: "0.6875rem", lineHeight: "1rem" },
      chat: { fontSize: "0.6875rem", lineHeight: "1.125rem" },
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
        chat: { fontSize: "0.5625rem", lineHeight: "1.125rem" },
        lg: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        xl: { fontSize: "1rem", lineHeight: "1.5rem" },
      },
      small: {
        xs: { fontSize: "0.46875rem", lineHeight: "0.75rem" },
        sm: { fontSize: "0.5625rem", lineHeight: "0.9375rem" },
        base: { fontSize: "0.625rem", lineHeight: "0.9375rem" },
        chat: { fontSize: "0.625rem", lineHeight: "1.125rem" },
        lg: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
        xl: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
      },
      default: {
        xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
        sm: { fontSize: "0.625rem", lineHeight: "1rem" },
        base: { fontSize: "0.6875rem", lineHeight: "1rem" },
        chat: { fontSize: "0.6875rem", lineHeight: "1.125rem" },
        lg: { fontSize: "0.875rem", lineHeight: "1.25rem" },
        xl: { fontSize: "1.125rem", lineHeight: "1.75rem" },
      },
      large: {
        xs: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
        sm: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
        base: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        chat: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        lg: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
        xl: { fontSize: "1.1875rem", lineHeight: "1.875rem" },
      },
      xlarge: {
        xs: { fontSize: "0.625rem", lineHeight: "1rem" },
        sm: { fontSize: "0.75rem", lineHeight: "1.125rem" },
        base: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
        chat: { fontSize: "0.8125rem", lineHeight: "1.125rem" },
        lg: { fontSize: "1rem", lineHeight: "1.5rem" },
        xl: { fontSize: "1.25rem", lineHeight: "2rem" },
      },
      xxlarge: {
        xs: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
        sm: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
        base: { fontSize: "0.875rem", lineHeight: "1.375rem" },
        chat: { fontSize: "0.875rem", lineHeight: "1.125rem" },
        lg: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
        xl: { fontSize: "1.3125rem", lineHeight: "2.125rem" },
      },
    });
  });

  it("preserves current default readable code values", () => {
    expect(READABLE_CODE_FONT_SCALES.default).toEqual({
      monacoFontSize: 11,
      monacoLineHeight: 18,
      diffsFontSize: "10px",
      diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
      codeFontSize: "0.625rem",
      codeLineHeight: "1.625",
    });
  });

  it("defines exact readable code preset values", () => {
    expect(READABLE_CODE_FONT_SCALES).toEqual({
      xsmall: {
        monacoFontSize: 9,
        monacoLineHeight: 15,
        diffsFontSize: "8px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.5rem",
        codeLineHeight: "1.625",
      },
      small: {
        monacoFontSize: 10,
        monacoLineHeight: 16,
        diffsFontSize: "9px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.5625rem",
        codeLineHeight: "1.625",
      },
      default: {
        monacoFontSize: 11,
        monacoLineHeight: 18,
        diffsFontSize: "10px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.625rem",
        codeLineHeight: "1.625",
      },
      large: {
        monacoFontSize: 13,
        monacoLineHeight: 21,
        diffsFontSize: "12px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.75rem",
        codeLineHeight: "1.625",
      },
      xlarge: {
        monacoFontSize: 15,
        monacoLineHeight: 24,
        diffsFontSize: "14px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "0.875rem",
        codeLineHeight: "1.625",
      },
      xxlarge: {
        monacoFontSize: 17,
        monacoLineHeight: 27,
        diffsFontSize: "16px",
        diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
        codeFontSize: "1rem",
        codeLineHeight: "1.625",
      },
    });
  });
});
