export interface TerminalGrid {
  cols: number;
  rows: number;
}

// Fallback only: terminals created at a guessed grid render the first zsh
// prompt at the wrong width, which leaves the PROMPT_SP "%" mark visible.
// Prefer a measured grid from the terminal grid probe.
export const DEFAULT_TERMINAL_GRID: TerminalGrid = { cols: 120, rows: 40 };

// Single source for the terminal font stack. The grid probe must measure with
// exactly the same renderer options as the live xterm surface.
export const TERMINAL_FONT_FAMILY =
  "'Geist Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace";

// xterm's lineHeight is a unitless renderer multiplier, not Monaco's pixel
// line height. Keep terminal rows proportional to the chosen readable-code
// font size and share the exact value with the pre-creation grid probe.
export const TERMINAL_LINE_HEIGHT = 1.2;
