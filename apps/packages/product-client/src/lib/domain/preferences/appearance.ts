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
  letterSpacing: string;
}

export interface UiFontScale {
  /** Secondary UI text — descriptions, secondary labels, notices, meta. */
  uiSm: TextTokenScale;
  /** Primary UI text — rows, pills, controls, popover items, menus, card titles. */
  ui: TextTokenScale;
  chat: TextTokenScale;
  /** Composer input text only. */
  composer: TextTokenScale;
  /** Ordinary body/prose outside transcript and composer surfaces. */
  body: TextTokenScale;
  /** Prominent body values and names outside title surfaces. */
  bodyEmphasis: TextTokenScale;
  /** Workspace name in the global header. */
  workspaceTitle: TextTokenScale;
  /** Compact card/dialog titles and level-three headings. */
  heading: TextTokenScale;
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
  "--text-ui-sm": string;
  "--text-ui-sm--line-height": string;
  "--text-ui-sm--letter-spacing": string;
  "--text-ui": string;
  "--text-ui--line-height": string;
  "--text-ui--letter-spacing": string;
  "--text-chat": string;
  "--text-chat--line-height": string;
  "--text-chat--letter-spacing": string;
  "--text-composer": string;
  "--text-composer--line-height": string;
  "--text-composer--letter-spacing": string;
  "--text-body": string;
  "--text-body--line-height": string;
  "--text-body--letter-spacing": string;
  "--text-body-emphasis": string;
  "--text-body-emphasis--line-height": string;
  "--text-body-emphasis--letter-spacing": string;
  "--text-workspace-title": string;
  "--text-workspace-title--line-height": string;
  "--text-workspace-title--letter-spacing": string;
  "--text-heading": string;
  "--text-heading--line-height": string;
  "--text-heading--letter-spacing": string;
  "--text-title": string;
  "--text-title--line-height": string;
  "--text-title--letter-spacing": string;
  "--text-hero": string;
  "--text-hero--line-height": string;
  "--text-hero--letter-spacing": string;
  "--text-sidebar-nav": string;
  "--text-sidebar-nav--line-height": string;
  "--text-sidebar-nav--letter-spacing": string;
  "--text-sidebar-row": string;
  "--text-sidebar-row--line-height": string;
  "--text-sidebar-row--letter-spacing": string;
  "--text-sidebar-brand": string;
  "--text-sidebar-brand--line-height": string;
  "--text-sidebar-brand--letter-spacing": string;
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
const READING_FONT_SIZES = [11, 11.5, 12, 13, 14, 15, 16, 17] as const;
const HERO_FONT_SIZES = [23, 24, 25, 26, 28, 29.5, 31, 32.5] as const;

function pixelScale(
  fontSize: number,
  lineHeight: number,
  letterSpacing: string,
): TextTokenScale {
  return {
    fontSize: `${fontSize}px`,
    lineHeight: `${lineHeight}px`,
    letterSpacing,
  };
}

function scaleRecord<T>(build: (index: number) => T): Record<AppearanceSizeId, T> {
  return Object.fromEntries(APPEARANCE_SIZE_IDS.map((id, index) => [id, build(index)])) as Record<AppearanceSizeId, T>;
}

function buildUiFontScale(index: number): UiFontScale {
  const reading = READING_FONT_SIZES[index]!;
  const hero = HERO_FONT_SIZES[index]!;
  return {
    uiSm: pixelScale(reading - 2, reading + 2, "0.01em"),
    ui: pixelScale(reading - 1, reading + 4, "0.005em"),
    chat: pixelScale(reading, reading + 7, "0"),
    composer: pixelScale(reading, reading + 7, "0"),
    body: pixelScale(reading, reading + 7, "0"),
    bodyEmphasis: pixelScale(reading + 1, reading + 8, "-0.005em"),
    workspaceTitle: pixelScale(reading + 1, reading + 8, "-0.005em"),
    heading: pixelScale(reading + 3, reading + 10, "-0.01em"),
    title: pixelScale(16 + index, 21 + index, "-0.025em"),
    hero: pixelScale(hero, hero + 8, "-0.025em"),
    sidebarNav: pixelScale(reading - 1, reading + 4, "0.005em"),
    sidebarRow: pixelScale(reading - 1, reading + 4, "0.005em"),
    sidebarBrand: pixelScale(reading + 3, reading + 10, "-0.01em"),
  };
}

export const UI_FONT_SCALES = /* @__PURE__ */ scaleRecord(buildUiFontScale);

function buildReadableCodeFontScale(index: number): ReadableCodeFontScale {
  const fontSize = READING_FONT_SIZES[index]!;
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
      [`${property}--letter-spacing`, token.letterSpacing],
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
  "--icon-paired": "1.230769em",
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
