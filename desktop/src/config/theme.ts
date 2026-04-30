// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export const THEME_PRESETS = ["mono", "ship", "tbpn", "original"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export const COLOR_MODES = ["dark", "light", "system"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

const MODE_LOCKED_PRESETS = new Set<ThemePreset>(["tbpn"]);

export function isModeLockedPreset(preset: ThemePreset): boolean {
  return MODE_LOCKED_PRESETS.has(preset);
}

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

function resolveAppliedMode(
  mode: ColorMode,
  preset: ThemePreset,
): "dark" | "light" {
  if (isModeLockedPreset(preset)) {
    return "dark";
  }
  return resolveMode(mode);
}

function applyMode(mode: ColorMode, preset: ThemePreset) {
  const resolved = resolveAppliedMode(mode, preset);
  document.documentElement.dataset.mode = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function applyThemePreference(
  preset: ThemePreset,
  mode: ColorMode,
) {
  document.documentElement.dataset.theme = preset;
  applyMode(mode, preset);
  notify();
}

export function initializeTheme(
  preset: ThemePreset = "mono",
  mode: ColorMode = "dark",
) {
  document.documentElement.dataset.theme = preset;
  applyMode(mode, preset);
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
    attributeFilter: ["data-theme", "data-mode"],
  });

  return () => {
    listeners.delete(cb);
    observer.disconnect();
  };
}

// ---------------------------------------------------------------------------
// Theme change observer (for non-React consumers like xterm)
// ---------------------------------------------------------------------------

export function onThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-mode"],
  });
  return () => observer.disconnect();
}

// ---------------------------------------------------------------------------
// Terminal theme reader
// ---------------------------------------------------------------------------

export function getResolvedMode(): "dark" | "light" {
  const mode = document.documentElement.dataset.mode;
  return isValidMode(mode)
    ? (mode === "system" ? "dark" : mode)
    : "dark";
}

export function getTerminalTheme(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    background: v("--color-background"),
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
