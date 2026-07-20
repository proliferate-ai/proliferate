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
  /** Workspace name in the global header. */
  workspaceTitle: TextTokenScale;
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
  "--text-workspace-title": string;
  "--text-workspace-title--line-height": string;
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

export type UiGlyphScaleCssVariables = {
  "--icon-status": string;
  "--icon-compact": string;
  "--icon-paired": string;
  "--icon-control": string;
  "--icon-large": string;
  "--icon-display": string;
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
/** Compact canonical numeric ladders; expanded once into the public API below. */
const COMPOSER_FONT_SIZES = [11, 11.5, 12, 13, 14, 15, 16, 17] as const;
const HERO_FONT_SIZES = [23, 24, 25, 26.5, 28, 29.5, 31, 32.5] as const;
const XS_REM_SCALES = [6.5, 11, 7, 11, 7, 11, 7.5, 12, 8, 12, 9, 14, 10, 16, 11, 18] as const;
const SM_REM_SCALES = [7.5, 13, 8, 13, 8, 13, 9, 15, 10, 16, 11, 17, 12, 18, 13, 19] as const;
const BASE_REM_SCALES = [8, 13, 8.5, 13.5, 9, 14, 10, 15, 11, 16, 12, 18, 13, 20, 14, 22] as const;
const LG_LINE_HEIGHTS = [17, 17.5, 18, 19, 20, 22, 24, 26] as const;
const XL_LINE_HEIGHTS = [22, 23, 24, 26, 28, 30, 32, 34] as const;

function rem(value: number): string {
  return `${value / 16}rem`;
}

function pixelScale(fontSize: number, lineHeight: number): TextTokenScale {
  return { fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` };
}

function remTokenScale(fontSize: number, lineHeight: number): TextTokenScale {
  return { fontSize: rem(fontSize), lineHeight: rem(lineHeight) };
}

function remScale(values: readonly number[], index: number): TextTokenScale {
  const offset = index * 2;
  return {
    fontSize: rem(values[offset]!),
    lineHeight: rem(values[offset + 1]!),
  };
}

function scaleRecord<T>(build: (index: number) => T): Record<AppearanceSizeId, T> {
  return Object.fromEntries(APPEARANCE_SIZE_IDS.map((id, index) => [id, build(index)])) as Record<AppearanceSizeId, T>;
}

function buildUiFontScale(index: number): UiFontScale {
  const composer = COMPOSER_FONT_SIZES[index]!;
  const hero = HERO_FONT_SIZES[index]!;
  return {
    xs: remScale(XS_REM_SCALES, index),
    sm: remScale(SM_REM_SCALES, index),
    base: remScale(BASE_REM_SCALES, index),
    uiSm: pixelScale(composer - 2, composer + 2),
    ui: pixelScale(composer - 1, composer + 4),
    chat: pixelScale(composer - 2, composer + 6),
    composer: pixelScale(composer, composer + 8),
    /** Every workspace-title rung stays 1px above message/composer. */
    workspaceTitle: pixelScale(composer + 1, composer + 9),
    lg: remTokenScale(composer, LG_LINE_HEIGHTS[index]!),
    xl: remTokenScale(composer + 4, XL_LINE_HEIGHTS[index]!),
    title: pixelScale(16 + index, 20 + index),
    hero: pixelScale(hero, hero + 8),
    sidebarNav: pixelScale(composer, composer + 5),
    sidebarRow: pixelScale(composer, composer + 5),
    sidebarBrand: pixelScale(composer + 3, composer + 10),
  };
}

export const UI_FONT_SCALES = /* @__PURE__ */ scaleRecord(buildUiFontScale);

function buildReadableCodeFontScale(index: number): ReadableCodeFontScale {
  const fontSize = COMPOSER_FONT_SIZES[index]!;
  const fontSizePx = `${fontSize}px`;
  return {
    monacoFontSize: fontSize,
    monacoLineHeight: fontSize + 8,
    diffsFontSize: fontSizePx,
    diffsLineHeight: "calc(var(--diffs-font-size) * 1.8)",
    codeFontSize: fontSizePx,
    codeLineHeight: "1.625",
  };
}

export const READABLE_CODE_FONT_SCALES = /* @__PURE__ */ scaleRecord(buildReadableCodeFontScale);

export const WINDOW_ZOOM_SCALES: Record<WindowZoomId, WindowZoomScale> = {
  zoom80: { factor: 0.8, cssValue: "0.8" },
  zoom90: { factor: 0.9, cssValue: "0.9" },
  default: { factor: 1, cssValue: "1" },
  zoom110: { factor: 1.1, cssValue: "1.1" },
  zoom120: { factor: 1.2, cssValue: "1.2" },
};

export function isAppearanceSizeId(value: unknown): value is AppearanceSizeId {
  return APPEARANCE_SIZE_IDS.includes(value as AppearanceSizeId);
}

export function resolveAppearanceSizeId(value: unknown): AppearanceSizeId {
  return isAppearanceSizeId(value) ? value : DEFAULT_APPEARANCE_SIZE_ID;
}

export function isWindowZoomId(value: unknown): value is WindowZoomId {
  return WINDOW_ZOOM_IDS.includes(value as WindowZoomId);
}

export function resolveWindowZoomId(value: unknown): WindowZoomId {
  return isWindowZoomId(value) ? value : DEFAULT_WINDOW_ZOOM_ID;
}

export function resolveUiFontScale(value: unknown): UiFontScale {
  return buildUiFontScale(APPEARANCE_SIZE_IDS.indexOf(resolveAppearanceSizeId(value)));
}

export function buildUiTextScaleCssVariables(scale: UiFontScale): UiTextScaleCssVariables {
  return Object.fromEntries((Object.entries(scale) as Array<[keyof UiFontScale, TextTokenScale]>).flatMap(([role, token]) => {
    const cssRole = role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const property = `--text-${cssRole}`;
    return [
      [property, token.fontSize],
      [`${property}--line-height`, token.lineHeight],
    ];
  })) as UiTextScaleCssVariables;
}

export const DEFAULT_UI_TEXT_SCALE_CSS_VARIABLES = /* @__PURE__ */ buildUiTextScaleCssVariables(
  /* @__PURE__ */ buildUiFontScale(APPEARANCE_SIZE_IDS.indexOf(DEFAULT_APPEARANCE_SIZE_ID)),
);

/** Visible glyphs are text-relative; fixed pointer targets remain on wrappers. */
export const DEFAULT_UI_GLYPH_SCALE_CSS_VARIABLES: UiGlyphScaleCssVariables = {
  "--icon-status": "0.55em",
  "--icon-compact": "1em",
  "--icon-paired": "1.15em",
  "--icon-control": "1.333333em",
  "--icon-large": "1.666667em",
  "--icon-display": "2em",
};

export function resolveReadableCodeFontScale(value: unknown): ReadableCodeFontScale {
  return buildReadableCodeFontScale(APPEARANCE_SIZE_IDS.indexOf(resolveAppearanceSizeId(value)));
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
