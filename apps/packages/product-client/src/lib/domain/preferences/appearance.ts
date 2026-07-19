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
  /** Visible workspace session/chat titles. */
  sessionTitle: TextTokenScale;
  lg: TextTokenScale;
  xl: TextTokenScale;
  /** Page/settings titles (SettingsPageHeader pairing). */
  title: TextTokenScale;
  /** Home hero heading. */
  hero: TextTokenScale;
  /** Sidebar primary nav + repo-group labels (codex --text-base tier). */
  sidebarNav: TextTokenScale;
  /** Sidebar workspace/thread rows + section headers (codex --text-sm tier). */
  sidebarRow: TextTokenScale;
  /** Sidebar brand wordmark (codex 17px tier). */
  sidebarBrand: TextTokenScale;
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
  "--text-session-title": string;
  "--text-session-title--line-height": string;
  "--text-lg": string;
  "--text-lg--line-height": string;
  "--text-xl": string;
  "--text-xl--line-height": string;
  "--text-title": string;
  "--text-title--line-height": string;
  "--text-hero": string;
  "--text-hero--line-height": string;
  "--text-sidebar-nav": string;
  "--text-sidebar-nav--line-height": string;
  "--text-sidebar-row": string;
  "--text-sidebar-row--line-height": string;
  "--text-sidebar-brand": string;
  "--text-sidebar-brand--line-height": string;
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
  xxsmall: "17px", xsmall: "17.5px", small: "18px", default: "19px",
  large: "20px", xlarge: "21px", xxlarge: "22px", xxxlarge: "23px",
};

/** Every session-title rung stays 1px above message/composer after preset advancement. */
export const UI_FONT_SCALES: Record<UiFontSizeId, UiFontScale> = {
  xxsmall: {
    xs: { fontSize: "0.40625rem", lineHeight: "0.6875rem" },
    sm: { fontSize: "0.46875rem", lineHeight: "0.8125rem" },
    base: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
    uiSm: { fontSize: "9px", lineHeight: "13px" },
    ui: { fontSize: "10px", lineHeight: "15px" },
    chat: { fontSize: "9px", lineHeight: CHAT_LINE_HEIGHTS.xxsmall },
    composer: { fontSize: "11px", lineHeight: "19px" },
    sessionTitle: { fontSize: "12px", lineHeight: "20px" },
    lg: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
    xl: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
    title: { fontSize: "16px", lineHeight: "20px" },
    hero: { fontSize: "23px", lineHeight: "31px" },
    sidebarNav: { fontSize: "11px", lineHeight: "16px" },
    sidebarRow: { fontSize: "11px", lineHeight: "16px" },
    sidebarBrand: { fontSize: "14px", lineHeight: "21px" },
  },
  xsmall: {
    xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
    sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
    base: { fontSize: "0.53125rem", lineHeight: "0.84375rem" },
    uiSm: { fontSize: "9.5px", lineHeight: "13.5px" },
    ui: { fontSize: "10.5px", lineHeight: "15.5px" },
    chat: { fontSize: "9.5px", lineHeight: CHAT_LINE_HEIGHTS.xsmall },
    composer: { fontSize: "11.5px", lineHeight: "19.5px" },
    sessionTitle: { fontSize: "12.5px", lineHeight: "20.5px" },
    lg: { fontSize: "0.71875rem", lineHeight: "1.09375rem" },
    xl: { fontSize: "0.96875rem", lineHeight: "1.4375rem" },
    title: { fontSize: "17px", lineHeight: "21px" },
    hero: { fontSize: "24px", lineHeight: "32px" },
    sidebarNav: { fontSize: "11.5px", lineHeight: "16.5px" },
    sidebarRow: { fontSize: "11.5px", lineHeight: "16.5px" },
    sidebarBrand: { fontSize: "14.5px", lineHeight: "21.5px" },
  },
  small: {
    xs: { fontSize: "0.4375rem", lineHeight: "0.6875rem" },
    sm: { fontSize: "0.5rem", lineHeight: "0.8125rem" },
    base: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
    uiSm: { fontSize: "10px", lineHeight: "14px" },
    ui: { fontSize: "11px", lineHeight: "16px" },
    chat: { fontSize: "10px", lineHeight: CHAT_LINE_HEIGHTS.small },
    composer: { fontSize: "12px", lineHeight: "20px" },
    sessionTitle: { fontSize: "13px", lineHeight: "21px" },
    lg: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    xl: { fontSize: "1rem", lineHeight: "1.5rem" },
    title: { fontSize: "18px", lineHeight: "22px" },
    hero: { fontSize: "25px", lineHeight: "33px" },
    sidebarNav: { fontSize: "12px", lineHeight: "17px" },
    sidebarRow: { fontSize: "12px", lineHeight: "17px" },
    sidebarBrand: { fontSize: "15px", lineHeight: "22px" },
  },
  default: {
    xs: { fontSize: "0.46875rem", lineHeight: "0.75rem" },
    sm: { fontSize: "0.5625rem", lineHeight: "0.9375rem" },
    base: { fontSize: "0.625rem", lineHeight: "0.9375rem" },
    uiSm: { fontSize: "11px", lineHeight: "15px" },
    ui: { fontSize: "12px", lineHeight: "17px" },
    chat: { fontSize: "11px", lineHeight: CHAT_LINE_HEIGHTS.default },
    composer: { fontSize: "13px", lineHeight: "21px" },
    sessionTitle: { fontSize: "14px", lineHeight: "22px" },
    lg: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
    xl: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
    title: { fontSize: "19px", lineHeight: "23px" },
    hero: { fontSize: "26.5px", lineHeight: "34.5px" },
    sidebarNav: { fontSize: "13px", lineHeight: "18px" },
    sidebarRow: { fontSize: "13px", lineHeight: "18px" },
    sidebarBrand: { fontSize: "16px", lineHeight: "23px" },
  },
  large: {
    xs: { fontSize: "0.5rem", lineHeight: "0.75rem" },
    sm: { fontSize: "0.625rem", lineHeight: "1rem" },
    base: { fontSize: "0.6875rem", lineHeight: "1rem" },
    uiSm: { fontSize: "12px", lineHeight: "16px" },
    ui: { fontSize: "13px", lineHeight: "18px" },
    chat: { fontSize: "12px", lineHeight: CHAT_LINE_HEIGHTS.large },
    composer: { fontSize: "14px", lineHeight: "22px" },
    sessionTitle: { fontSize: "15px", lineHeight: "23px" },
    lg: { fontSize: "0.875rem", lineHeight: "1.25rem" },
    xl: { fontSize: "1.125rem", lineHeight: "1.75rem" },
    title: { fontSize: "20px", lineHeight: "24px" },
    hero: { fontSize: "28px", lineHeight: "36px" },
    sidebarNav: { fontSize: "14px", lineHeight: "19px" },
    sidebarRow: { fontSize: "14px", lineHeight: "19px" },
    sidebarBrand: { fontSize: "17px", lineHeight: "24px" },
  },
  xlarge: {
    xs: { fontSize: "0.5625rem", lineHeight: "0.875rem" },
    sm: { fontSize: "0.6875rem", lineHeight: "1.0625rem" },
    base: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    uiSm: { fontSize: "13px", lineHeight: "17px" },
    ui: { fontSize: "14px", lineHeight: "19px" },
    chat: { fontSize: "13px", lineHeight: CHAT_LINE_HEIGHTS.xlarge },
    composer: { fontSize: "15px", lineHeight: "23px" },
    sessionTitle: { fontSize: "16px", lineHeight: "24px" },
    lg: { fontSize: "0.9375rem", lineHeight: "1.375rem" },
    xl: { fontSize: "1.1875rem", lineHeight: "1.875rem" },
    title: { fontSize: "21px", lineHeight: "25px" },
    hero: { fontSize: "29.5px", lineHeight: "37.5px" },
    sidebarNav: { fontSize: "15px", lineHeight: "20px" },
    sidebarRow: { fontSize: "15px", lineHeight: "20px" },
    sidebarBrand: { fontSize: "18px", lineHeight: "25px" },
  },
  xxlarge: {
    xs: { fontSize: "0.625rem", lineHeight: "1rem" },
    sm: { fontSize: "0.75rem", lineHeight: "1.125rem" },
    base: { fontSize: "0.8125rem", lineHeight: "1.25rem" },
    uiSm: { fontSize: "14px", lineHeight: "18px" },
    ui: { fontSize: "15px", lineHeight: "20px" },
    chat: { fontSize: "14px", lineHeight: CHAT_LINE_HEIGHTS.xxlarge },
    composer: { fontSize: "16px", lineHeight: "24px" },
    sessionTitle: { fontSize: "17px", lineHeight: "25px" },
    lg: { fontSize: "1rem", lineHeight: "1.5rem" },
    xl: { fontSize: "1.25rem", lineHeight: "2rem" },
    title: { fontSize: "22px", lineHeight: "26px" },
    hero: { fontSize: "31px", lineHeight: "39px" },
    sidebarNav: { fontSize: "16px", lineHeight: "21px" },
    sidebarRow: { fontSize: "16px", lineHeight: "21px" },
    sidebarBrand: { fontSize: "19px", lineHeight: "26px" },
  },
  xxxlarge: {
    xs: { fontSize: "0.6875rem", lineHeight: "1.125rem" },
    sm: { fontSize: "0.8125rem", lineHeight: "1.1875rem" },
    base: { fontSize: "0.875rem", lineHeight: "1.375rem" },
    uiSm: { fontSize: "15px", lineHeight: "19px" },
    ui: { fontSize: "16px", lineHeight: "21px" },
    chat: { fontSize: "15px", lineHeight: CHAT_LINE_HEIGHTS.xxxlarge },
    composer: { fontSize: "17px", lineHeight: "25px" },
    sessionTitle: { fontSize: "18px", lineHeight: "26px" },
    lg: { fontSize: "1.0625rem", lineHeight: "1.625rem" },
    xl: { fontSize: "1.3125rem", lineHeight: "2.125rem" },
    title: { fontSize: "23px", lineHeight: "27px" },
    hero: { fontSize: "32.5px", lineHeight: "40.5px" },
    sidebarNav: { fontSize: "17px", lineHeight: "22px" },
    sidebarRow: { fontSize: "17px", lineHeight: "22px" },
    sidebarBrand: { fontSize: "20px", lineHeight: "27px" },
  },
};

export const READABLE_CODE_FONT_SCALES: Record<ReadableCodeFontSizeId, ReadableCodeFontScale> = {
  xxsmall: {
    monacoFontSize: 8,
    monacoLineHeight: 14.5,
    diffsFontSize: "8px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.5rem",
    codeLineHeight: "1.625",
  },
  xsmall: {
    monacoFontSize: 8.5,
    monacoLineHeight: 15.5,
    diffsFontSize: "8.5px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.53125rem",
    codeLineHeight: "1.625",
  },
  small: {
    monacoFontSize: 9,
    monacoLineHeight: 16,
    diffsFontSize: "9px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.5625rem",
    codeLineHeight: "1.625",
  },
  default: {
    monacoFontSize: 10,
    monacoLineHeight: 17,
    diffsFontSize: "10px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.625rem",
    codeLineHeight: "1.625",
  },
  large: {
    monacoFontSize: 11,
    monacoLineHeight: 18,
    diffsFontSize: "11px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.6875rem",
    codeLineHeight: "1.625",
  },
  xlarge: {
    monacoFontSize: 12,
    monacoLineHeight: 20,
    diffsFontSize: "12px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.75rem",
    codeLineHeight: "1.625",
  },
  xxlarge: {
    monacoFontSize: 13,
    monacoLineHeight: 21,
    diffsFontSize: "13px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.8125rem",
    codeLineHeight: "1.625",
  },
  xxxlarge: {
    monacoFontSize: 14,
    monacoLineHeight: 22,
    diffsFontSize: "14px",
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: "0.875rem",
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
    "--text-session-title": scale.sessionTitle.fontSize,
    "--text-session-title--line-height": scale.sessionTitle.lineHeight,
    "--text-lg": scale.lg.fontSize,
    "--text-lg--line-height": scale.lg.lineHeight,
    "--text-xl": scale.xl.fontSize,
    "--text-xl--line-height": scale.xl.lineHeight,
    "--text-title": scale.title.fontSize,
    "--text-title--line-height": scale.title.lineHeight,
    "--text-hero": scale.hero.fontSize,
    "--text-hero--line-height": scale.hero.lineHeight,
    "--text-sidebar-nav": scale.sidebarNav.fontSize,
    "--text-sidebar-nav--line-height": scale.sidebarNav.lineHeight,
    "--text-sidebar-row": scale.sidebarRow.fontSize,
    "--text-sidebar-row--line-height": scale.sidebarRow.lineHeight,
    "--text-sidebar-brand": scale.sidebarBrand.fontSize,
    "--text-sidebar-brand--line-height": scale.sidebarBrand.lineHeight,
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
