export const APPEARANCE_SIZE_IDS = [
  "xxsmall",
  "xsmall",
  "small",
  "default",
  "large",
  "xlarge",
  "xxlarge",
  "xxxlarge",
] as const;

export type AppearanceSizeId = (typeof APPEARANCE_SIZE_IDS)[number];
export type UiFontSizeId = AppearanceSizeId;
export type ReadableCodeFontSizeId = AppearanceSizeId;

export const WINDOW_ZOOM_IDS = [
  "zoom80",
  "zoom90",
  "default",
  "zoom110",
  "zoom120",
] as const;

export type WindowZoomId = (typeof WINDOW_ZOOM_IDS)[number];

export interface TextTokenScale {
  fontSize: string;
  lineHeight: string;
}

export interface UiFontScale {
  xs: TextTokenScale;
  sm: TextTokenScale;
  base: TextTokenScale;
  /** Secondary UI text — descriptions, secondary labels, notices, meta. */
  uiSm: TextTokenScale;
  /** Primary UI text — rows, pills, controls, popover items, menus, card titles. */
  ui: TextTokenScale;
  chat: TextTokenScale;
  /** Composer input text only. */
  composer: TextTokenScale;
  lg: TextTokenScale;
  xl: TextTokenScale;
  /** Page/settings titles (SettingsPageHeader pairing). */
  title: TextTokenScale;
  /** Home hero heading. */
  hero: TextTokenScale;
}

export type UiTextScaleCssVariables = {
  "--text-xs": string;
  "--text-xs--line-height": string;
  "--text-sm": string;
  "--text-sm--line-height": string;
  "--text-base": string;
  "--text-base--line-height": string;
  "--text-ui-sm": string;
  "--text-ui-sm--line-height": string;
  "--text-ui": string;
  "--text-ui--line-height": string;
  "--text-chat": string;
  "--text-chat--line-height": string;
  "--text-composer": string;
  "--text-composer--line-height": string;
  "--text-lg": string;
  "--text-lg--line-height": string;
  "--text-xl": string;
  "--text-xl--line-height": string;
  "--text-title": string;
  "--text-title--line-height": string;
  "--text-hero": string;
  "--text-hero--line-height": string;
};

export interface ReadableCodeFontScale {
  monacoFontSize: number;
  monacoLineHeight: number;
  diffsFontSize: string;
  diffsLineHeight: string;
  codeFontSize: string;
  codeLineHeight: string;
}

export interface WindowZoomScale {
  factor: number;
  cssValue: string;
}

export const DEFAULT_APPEARANCE_SIZE_ID: AppearanceSizeId = "default";
export const DEFAULT_WINDOW_ZOOM_ID: WindowZoomId = "default";
export const CHAT_LINE_HEIGHTS: Record<UiFontSizeId, string> = {
  xxsmall: "17.5px",
  xsmall: "18px",
  small: "19px",
  default: "20px",
  large: "21px",
  xlarge: "22px",
  xxlarge: "23px",
  xxxlarge: "24px",
};

/**
 * Preset stepping for the semantic slots:
 * - ui / uiSm / composer mirror the chat column's per-preset deltas
 *   (-2.5, -2, -1, 0, +1, +2, +3, +4 px from the default anchor).
 * - title / hero scale proportionally with the heading-class tokens
 *   (factor = xl px / 18px at each preset), rounded to 0.5px, so the
 *   heading-to-body visual ratio holds across presets.
 * - Line heights keep the default anchor's delta from the font size:
 *   ui +5px, uiSm +4px, composer +8px, title +4px, hero +8px.
 */
export const UI_FONT_SCALES: Record<UiFontSizeId, UiFontScale> = {
  xxsmall: {
    xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
    sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
    base: { fontSize: "0.53125rem", lineHeight: "0.84375rem" },
    uiSm: { fontSize: "9.5px", lineHeight: "13.5px" },
    ui: { fontSize: "10.5px", lineHeight: "15.5px" },
    chat: { fontSize: "9.5px", lineHeight: CHAT_LINE_HEIGHTS.xxsmall },
    composer: { fontSize: "11.5px", lineHeight: "19.5px" },
    lg: { fontSize: "0.71875rem", lineHeight: "1.09375rem" },
    xl: { fontSize: "0.96875rem", lineHeight: "1.4375rem" },
    title: { fontSize: "17px", lineHeight: "21px" },
    hero: { fontSize: "24px", lineHeight: "32px" },
  },
  xsmall: {
    xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
    sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
    base: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
    uiSm: { fontSize: "10px", lineHeight: "14px" },
    ui: { fontSize: "11px", lineHeight: "16px" },
    chat: { fontSize: "10px", lineHeight: CHAT_LINE_HEIGHTS.xsmall },
    composer: { fontSize: "12px", lineHeight: "20px" },
    lg: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    xl: { fontSize: "1rem", lineHeight: "1.5rem" },
    title: { fontSize: "18px", lineHeight: "22px" },
    hero: { fontSize: "25px", lineHeight: "33px" },
  },
  small: {
    xs: { fontSize: "0.46875rem", lineHeight: "0.75rem" },
    sm: { fontSize: "0.5625rem", lineHeight: "0.9375rem" },
    base: { fontSize: "0.625rem", lineHeight: "0.9375rem" },
    uiSm: { fontSize: "11px", lineHeight: "15px" },
    ui: { fontSize: "12px", lineHeight: "17px" },
    chat: { fontSize: "11px", lineHeight: CHAT_LINE_HEIGHTS.small },
    composer: { fontSize: "13px", lineHeight: "21px" },
    lg: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
    xl: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
    title: { fontSize: "19px", lineHeight: "23px" },
    hero: { fontSize: "26.5px", lineHeight: "34.5px" },
  },
  default: {
    xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
    sm: { fontSize: "0.625rem", lineHeight: "1rem" },
    base: { fontSize: "0.6875rem", lineHeight: "1rem" },
    uiSm: { fontSize: "12px", lineHeight: "16px" },
    ui: { fontSize: "13px", lineHeight: "18px" },
    chat: { fontSize: "12px", lineHeight: CHAT_LINE_HEIGHTS.default },
    composer: { fontSize: "14px", lineHeight: "22px" },
    lg: { fontSize: "0.875rem", lineHeight: "1.25rem" },
    xl: { fontSize: "1.125rem", lineHeight: "1.75rem" },
    title: { fontSize: "20px", lineHeight: "24px" },
    hero: { fontSize: "28px", lineHeight: "36px" },
  },
  large: {
    xs: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
    sm: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
    base: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    uiSm: { fontSize: "13px", lineHeight: "17px" },
    ui: { fontSize: "14px", lineHeight: "19px" },
    chat: { fontSize: "13px", lineHeight: CHAT_LINE_HEIGHTS.large },
    composer: { fontSize: "15px", lineHeight: "23px" },
    lg: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
    xl: { fontSize: "1.1875rem", lineHeight: "1.875rem" },
    title: { fontSize: "21px", lineHeight: "25px" },
    hero: { fontSize: "29.5px", lineHeight: "37.5px" },
  },
  xlarge: {
    xs: { fontSize: "0.625rem", lineHeight: "1rem" },
    sm: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    base: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
    uiSm: { fontSize: "14px", lineHeight: "18px" },
    ui: { fontSize: "15px", lineHeight: "20px" },
    chat: { fontSize: "14px", lineHeight: CHAT_LINE_HEIGHTS.xlarge },
    composer: { fontSize: "16px", lineHeight: "24px" },
    lg: { fontSize: "1rem", lineHeight: "1.5rem" },
    xl: { fontSize: "1.25rem", lineHeight: "2rem" },
    title: { fontSize: "22px", lineHeight: "26px" },
    hero: { fontSize: "31px", lineHeight: "39px" },
  },
  xxlarge: {
    xs: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
    sm: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
    base: { fontSize: "0.875rem", lineHeight: "1.375rem" },
    uiSm: { fontSize: "15px", lineHeight: "19px" },
    ui: { fontSize: "16px", lineHeight: "21px" },
    chat: { fontSize: "15px", lineHeight: CHAT_LINE_HEIGHTS.xxlarge },
    composer: { fontSize: "17px", lineHeight: "25px" },
    lg: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
    xl: { fontSize: "1.3125rem", lineHeight: "2.125rem" },
    title: { fontSize: "23.5px", lineHeight: "27.5px" },
    hero: { fontSize: "32.5px", lineHeight: "40.5px" },
  },
  xxxlarge: {
    xs: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    sm: { fontSize: "0.875rem", lineHeight: "1.3125rem" },
    base: { fontSize: "0.9375rem", lineHeight: "1.5rem" },
    uiSm: { fontSize: "16px", lineHeight: "20px" },
    ui: { fontSize: "17px", lineHeight: "22px" },
    chat: { fontSize: "16px", lineHeight: CHAT_LINE_HEIGHTS.xxxlarge },
    composer: { fontSize: "18px", lineHeight: "26px" },
    lg: { fontSize: "1.125rem", lineHeight: "1.75rem" },
    xl: { fontSize: "1.375rem", lineHeight: "2.25rem" },
    title: { fontSize: "24.5px", lineHeight: "28.5px" },
    hero: { fontSize: "34px", lineHeight: "42px" },
  },
};

export const READABLE_CODE_FONT_SCALES: Record<ReadableCodeFontSizeId, ReadableCodeFontScale> = {
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
};

export const WINDOW_ZOOM_SCALES: Record<WindowZoomId, WindowZoomScale> = {
  zoom80: { factor: 0.8, cssValue: "0.8" },
  zoom90: { factor: 0.9, cssValue: "0.9" },
  default: { factor: 1, cssValue: "1" },
  zoom110: { factor: 1.1, cssValue: "1.1" },
  zoom120: { factor: 1.2, cssValue: "1.2" },
};

export function isAppearanceSizeId(value: unknown): value is AppearanceSizeId {
  return typeof value === "string" && APPEARANCE_SIZE_IDS.includes(value as AppearanceSizeId);
}

export function resolveAppearanceSizeId(value: unknown): AppearanceSizeId {
  return isAppearanceSizeId(value) ? value : DEFAULT_APPEARANCE_SIZE_ID;
}

export function isWindowZoomId(value: unknown): value is WindowZoomId {
  return typeof value === "string" && WINDOW_ZOOM_IDS.includes(value as WindowZoomId);
}

export function resolveWindowZoomId(value: unknown): WindowZoomId {
  return isWindowZoomId(value) ? value : DEFAULT_WINDOW_ZOOM_ID;
}

export function resolveUiFontScale(value: unknown): UiFontScale {
  return UI_FONT_SCALES[resolveAppearanceSizeId(value)];
}

export function buildUiTextScaleCssVariables(scale: UiFontScale): UiTextScaleCssVariables {
  return {
    "--text-xs": scale.xs.fontSize,
    "--text-xs--line-height": scale.xs.lineHeight,
    "--text-sm": scale.sm.fontSize,
    "--text-sm--line-height": scale.sm.lineHeight,
    "--text-base": scale.base.fontSize,
    "--text-base--line-height": scale.base.lineHeight,
    "--text-ui-sm": scale.uiSm.fontSize,
    "--text-ui-sm--line-height": scale.uiSm.lineHeight,
    "--text-ui": scale.ui.fontSize,
    "--text-ui--line-height": scale.ui.lineHeight,
    "--text-chat": scale.chat.fontSize,
    "--text-chat--line-height": scale.chat.lineHeight,
    "--text-composer": scale.composer.fontSize,
    "--text-composer--line-height": scale.composer.lineHeight,
    "--text-lg": scale.lg.fontSize,
    "--text-lg--line-height": scale.lg.lineHeight,
    "--text-xl": scale.xl.fontSize,
    "--text-xl--line-height": scale.xl.lineHeight,
    "--text-title": scale.title.fontSize,
    "--text-title--line-height": scale.title.lineHeight,
    "--text-hero": scale.hero.fontSize,
    "--text-hero--line-height": scale.hero.lineHeight,
  };
}

export const DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES = buildUiTextScaleCssVariables(
  UI_FONT_SCALES[DEFAULT_APPEARANCE_SIZE_ID],
);

export function resolveReadableCodeFontScale(value: unknown): ReadableCodeFontScale {
  return READABLE_CODE_FONT_SCALES[resolveAppearanceSizeId(value)];
}

export function resolveWindowZoomScale(value: unknown): WindowZoomScale {
  return WINDOW_ZOOM_SCALES[resolveWindowZoomId(value)];
}

export function stepAppearanceSizeId(
  value: unknown,
  delta: -1 | 1,
): AppearanceSizeId {
  const current = resolveAppearanceSizeId(value);
  const index = APPEARANCE_SIZE_IDS.indexOf(current);
  const nextIndex = Math.max(
    0,
    Math.min(APPEARANCE_SIZE_IDS.length - 1, index + delta),
  );
  return APPEARANCE_SIZE_IDS[nextIndex] ?? DEFAULT_APPEARANCE_SIZE_ID;
}

export function stepWindowZoomId(
  value: unknown,
  delta: -1 | 1,
): WindowZoomId {
  const current = resolveWindowZoomId(value);
  const index = WINDOW_ZOOM_IDS.indexOf(current);
  const nextIndex = Math.max(
    0,
    Math.min(WINDOW_ZOOM_IDS.length - 1, index + delta),
  );
  return WINDOW_ZOOM_IDS[nextIndex] ?? DEFAULT_WINDOW_ZOOM_ID;
}

export function stepAppearanceFontSizes(
  input: {
    uiFontSizeId: unknown;
    readableCodeFontSizeId: unknown;
  },
  delta: -1 | 1,
): {
  uiFontSizeId: UiFontSizeId;
  readableCodeFontSizeId: ReadableCodeFontSizeId;
} {
  return {
    uiFontSizeId: stepAppearanceSizeId(input.uiFontSizeId, delta),
    readableCodeFontSizeId: stepAppearanceSizeId(input.readableCodeFontSizeId, delta),
  };
}
