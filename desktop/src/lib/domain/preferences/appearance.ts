export const APPEARANCE_SIZE_IDS = ["xsmall", "small", "default", "large", "xlarge", "xxlarge"] as const;

export type AppearanceSizeId = (typeof APPEARANCE_SIZE_IDS)[number];
export type UiFontSizeId = AppearanceSizeId;
export type ReadableCodeFontSizeId = AppearanceSizeId;

export interface TextTokenScale {
  fontSize: string;
  lineHeight: string;
}

export interface UiFontScale {
  xs: TextTokenScale;
  sm: TextTokenScale;
  base: TextTokenScale;
  chat: TextTokenScale;
  lg: TextTokenScale;
  xl: TextTokenScale;
}

export interface ReadableCodeFontScale {
  monacoFontSize: number;
  monacoLineHeight: number;
  diffsFontSize: string;
  diffsLineHeight: string;
  codeFontSize: string;
  codeLineHeight: string;
}

export const DEFAULT_APPEARANCE_SIZE_ID: AppearanceSizeId = "default";
export const CHAT_LINE_HEIGHTS: Record<UiFontSizeId, string> = {
  xsmall: "18px",
  small: "19px",
  default: "20px",
  large: "21px",
  xlarge: "22px",
  xxlarge: "23px",
};

export const UI_FONT_SCALES: Record<UiFontSizeId, UiFontScale> = {
  xsmall: {
    xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
    sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
    base: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
    chat: { fontSize: "10px", lineHeight: CHAT_LINE_HEIGHTS.xsmall },
    lg: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    xl: { fontSize: "1rem", lineHeight: "1.5rem" },
  },
  small: {
    xs: { fontSize: "0.46875rem", lineHeight: "0.75rem" },
    sm: { fontSize: "0.5625rem", lineHeight: "0.9375rem" },
    base: { fontSize: "0.625rem", lineHeight: "0.9375rem" },
    chat: { fontSize: "11px", lineHeight: CHAT_LINE_HEIGHTS.small },
    lg: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
    xl: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
  },
  default: {
    xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
    sm: { fontSize: "0.625rem", lineHeight: "1rem" },
    base: { fontSize: "0.6875rem", lineHeight: "1rem" },
    chat: { fontSize: "12px", lineHeight: CHAT_LINE_HEIGHTS.default },
    lg: { fontSize: "0.875rem", lineHeight: "1.25rem" },
    xl: { fontSize: "1.125rem", lineHeight: "1.75rem" },
  },
  large: {
    xs: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
    sm: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
    base: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    chat: { fontSize: "13px", lineHeight: CHAT_LINE_HEIGHTS.large },
    lg: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
    xl: { fontSize: "1.1875rem", lineHeight: "1.875rem" },
  },
  xlarge: {
    xs: { fontSize: "0.625rem", lineHeight: "1rem" },
    sm: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    base: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
    chat: { fontSize: "14px", lineHeight: CHAT_LINE_HEIGHTS.xlarge },
    lg: { fontSize: "1rem", lineHeight: "1.5rem" },
    xl: { fontSize: "1.25rem", lineHeight: "2rem" },
  },
  xxlarge: {
    xs: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
    sm: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
    base: { fontSize: "0.875rem", lineHeight: "1.375rem" },
    chat: { fontSize: "15px", lineHeight: CHAT_LINE_HEIGHTS.xxlarge },
    lg: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
    xl: { fontSize: "1.3125rem", lineHeight: "2.125rem" },
  },
};

export const READABLE_CODE_FONT_SCALES: Record<ReadableCodeFontSizeId, ReadableCodeFontScale> = {
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
};

export function isAppearanceSizeId(value: unknown): value is AppearanceSizeId {
  return typeof value === "string" && APPEARANCE_SIZE_IDS.includes(value as AppearanceSizeId);
}

export function resolveAppearanceSizeId(value: unknown): AppearanceSizeId {
  return isAppearanceSizeId(value) ? value : DEFAULT_APPEARANCE_SIZE_ID;
}

export function resolveUiFontScale(value: unknown): UiFontScale {
  return UI_FONT_SCALES[resolveAppearanceSizeId(value)];
}

export function resolveReadableCodeFontScale(value: unknown): ReadableCodeFontScale {
  return READABLE_CODE_FONT_SCALES[resolveAppearanceSizeId(value)];
}
