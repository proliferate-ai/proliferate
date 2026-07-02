import {
  buildUiTextScaleCssVariables,
  DEFAULT_APPEARANCE_SIZE_ID,
  DEFAULT_WINDOW_ZOOM_ID,
  resolveAppearanceSizeId,
  resolveReadableCodeFontScale,
  resolveUiFontScale,
  resolveWindowZoomId,
  resolveWindowZoomScale,
  type ReadableCodeFontSizeId,
  type UiFontSizeId,
  type WindowZoomId,
} from "@/lib/domain/preferences/appearance";

// ---------------------------------------------------------------------------
// Color mode (the app ships a single Mono theme; mode is the only switch)
// ---------------------------------------------------------------------------

export const COLOR_MODES = ["dark", "light", "system"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

function isValidMode(v: string | null | undefined): v is ColorMode {
  return COLOR_MODES.includes(v as ColorMode);
}

// ---------------------------------------------------------------------------
// Resolve "system" to actual dark/light
// ---------------------------------------------------------------------------

function resolveMode(mode: ColorMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

function applyMode(mode: ColorMode) {
  const resolved = resolveMode(mode);
  document.documentElement.dataset.mode = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export interface AppearancePreference {
  colorMode: ColorMode;
  uiFontSizeId: UiFontSizeId;
  readableCodeFontSizeId: ReadableCodeFontSizeId;
  windowZoomId: WindowZoomId;
}

export function applyAppearancePreference({
  colorMode,
  uiFontSizeId,
  readableCodeFontSizeId,
  windowZoomId,
}: AppearancePreference) {
  const root = document.documentElement;
  const resolvedUiFontSizeId = resolveAppearanceSizeId(uiFontSizeId);
  const resolvedReadableCodeFontSizeId = resolveAppearanceSizeId(readableCodeFontSizeId);
  const resolvedWindowZoomId = resolveWindowZoomId(windowZoomId);
  const uiScale = resolveUiFontScale(resolvedUiFontSizeId);
  const readableCodeScale = resolveReadableCodeFontScale(resolvedReadableCodeFontSizeId);
  const windowZoomScale = resolveWindowZoomScale(resolvedWindowZoomId);

  root.dataset.uiFontSize = resolvedUiFontSizeId;
  root.dataset.readableCodeFontSize = resolvedReadableCodeFontSizeId;
  root.dataset.windowZoom = resolvedWindowZoomId;
  applyMode(colorMode);

  for (const [property, value] of Object.entries(buildUiTextScaleCssVariables(uiScale))) {
    root.style.setProperty(property, value);
  }

  root.style.setProperty("--diffs-font-size", readableCodeScale.diffsFontSize);
  root.style.setProperty("--diffs-line-height", readableCodeScale.diffsLineHeight);
  root.style.setProperty("--readable-code-font-size", readableCodeScale.codeFontSize);
  root.style.setProperty("--readable-code-line-height", readableCodeScale.codeLineHeight);
  root.style.setProperty("--proliferate-window-zoom", windowZoomScale.cssValue);

  notify();
}

export function initializeTheme(mode: ColorMode = "dark") {
  applyMode(mode);
  document.documentElement.dataset.uiFontSize = DEFAULT_APPEARANCE_SIZE_ID;
  document.documentElement.dataset.readableCodeFontSize = DEFAULT_APPEARANCE_SIZE_ID;
  document.documentElement.dataset.windowZoom = DEFAULT_WINDOW_ZOOM_ID;
}

// ---------------------------------------------------------------------------
// Subscriber notification
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribe(cb: () => void) {
  listeners.add(cb);

  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mode"],
  });

  return () => {
    listeners.delete(cb);
    observer.disconnect();
  };
}

// ---------------------------------------------------------------------------
// Mode change observer (for non-React consumers like xterm)
// ---------------------------------------------------------------------------

export function onThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mode"],
  });
  return () => observer.disconnect();
}

// ---------------------------------------------------------------------------
// Terminal theme reader
// ---------------------------------------------------------------------------

export function getResolvedMode(): "dark" | "light" {
  if (typeof document === "undefined") {
    // Theme-aware consumers can be imported in non-DOM test contexts.
    return "dark";
  }
  const mode = document.documentElement.dataset.mode;
  return isValidMode(mode)
    ? (mode === "system" ? "dark" : mode)
    : "dark";
}

export function getTerminalTheme(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    background: v("--color-sidebar"),
    foreground: v("--color-foreground"),
    cursor: v("--color-foreground"),
    selectionBackground: v("--color-input"),
    black: v("--color-terminal-black"),
    red: v("--color-terminal-red"),
    green: v("--color-terminal-green"),
    yellow: v("--color-terminal-yellow"),
    blue: v("--color-terminal-blue"),
    magenta: v("--color-terminal-magenta"),
    cyan: v("--color-terminal-cyan"),
    white: v("--color-terminal-white"),
    brightBlack: v("--color-terminal-bright-black"),
    brightRed: v("--color-terminal-bright-red"),
    brightGreen: v("--color-terminal-bright-green"),
    brightYellow: v("--color-terminal-bright-yellow"),
    brightBlue: v("--color-terminal-bright-blue"),
    brightMagenta: v("--color-terminal-bright-magenta"),
    brightCyan: v("--color-terminal-bright-cyan"),
    brightWhite: v("--color-terminal-bright-white"),
  };
}
