/**
 * The raw layer: every physical color the value system is built from, named
 * by ramp and rung rather than by role. Nothing here is a token — no `--*`
 * custom property is ever emitted for a palette entry — and nothing here
 * carries meaning. Meaning is assigned one layer up, in `tokens.ts`, where a
 * semantic role (`--color-border`, `--color-surface-under`) picks a rung.
 *
 * Layer law (enforced by `scripts/check-theme.mjs`): a `semantic`-layer token
 * may only paint with colors that appear in this file. Special-purpose
 * palettes — terminal ANSI, compute-target hues, the delegated-agent ring, the
 * diff tints, window-control glyphs — stay as literals on their `component`
 * tokens because they are artwork, not system values.
 *
 * Every value below is a shipped literal carried verbatim from the token
 * authority; this file introduces no new color. The restyle changes values
 * here (and only here) for the neutral and accent ramps; roles inherit.
 */

/** The single light-mode ink. Every light neutral alpha role is this ink at some opacity. */
const INK = "#1a1c1f";
const INK_RGB = "26, 28, 31";
const PAPER = "#ffffff";
const PAPER_RGB = "255, 255, 255";

export const palette = {
  ink: INK,
  paper: PAPER,
  black: "#000000",

  /**
   * Neutral planes, darkest first. Dark mode builds its surface steps from
   * this ladder (`0` is the deepest primary-foreground plane, `3` the page
   * canvas, `4` the card, `8` the lifted control/popover plane); light mode
   * has only three opaque planes and derives the rest from `ink` alpha.
   */
  neutral: {
    dark: {
      0: "#0d0d0d",
      1: "#111111",
      2: "#141414",
      3: "#181818",
      4: "#212121",
      5: "#222222",
      6: "#282828",
      7: "#2b2b2b",
      8: "#2d2d2d",
    },
    light: {
      /** The editor plane, one step off paper. */
      1: "#fafafa",
      /** The rail plane: sidebar, surface-under, the composer fill. */
      2: "#f6f6f6",
    },
  },

  /** The single accent hue. `deep` is the light-mode accent, `base` the dark-mode one. */
  blue: {
    tint: "#e5f2ff",
    soft: "#83c3ff",
    /** The dark-mode sidebar focus ring (`rgba(127, 193, 255, 0.747)`); a shipped off-ramp hue the restyle can fold into `base`. */
    glow: "#7fc1ff",
    base: "#339cff",
    deep: "#0b6bcb",
  },
  green: { tint: "#e6f4ec", base: "#40c977", deep: "#0a7c3f" },
  red: { tint: "#fbe9e8", soft: "#ff6764", base: "#fa423e", deep: "#c02622" },
  amber: {
    tint: "#fdf3dc",
    edge: "#e8d9ae",
    /** The `warning-subtle` wash hue, only ever painted at alpha. */
    wash: "#f2c94c",
    soft: "#ffcc33",
    base: "#ffb432",
    deep: "#8a5a00",
  },
  yellow: { base: "#ffd240", deep: "#ffc300" },
  violet: { base: "#ad7bf9", deep: "#8250df" },
  pink: { base: "#fb5d8f", deep: "#c7175c" },

  /** Light-mode neutral alpha: the ink at an opacity. */
  inkAlpha(alpha: number): string {
    return `rgba(${INK_RGB}, ${alpha})`;
  },
  /** Dark-mode neutral alpha as a resolved literal (the `@theme` fallback form). */
  paperAlpha(alpha: number): string {
    return `rgba(${PAPER_RGB}, ${alpha})`;
  },
  /** Dark-mode neutral alpha in its runtime `color-mix()` form. */
  paperMix(percent: number): string {
    return `color-mix(in oklab, ${PAPER} ${percent}%, transparent)`;
  },
} as const;

/**
 * Every literal hex the palette owns, lowercased, for the layer law. Helper
 * outputs (`inkAlpha`, `paperAlpha`, `paperMix`) resolve to `ink`/`paper`,
 * which are members.
 */
export function paletteHexes(): ReadonlySet<string> {
  const out = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (/^#[0-9a-f]{6}$/i.test(value)) out.add(value.toLowerCase());
      return;
    }
    if (value && typeof value === "object") {
      for (const inner of Object.values(value as Record<string, unknown>)) visit(inner);
    }
  };
  visit(palette);
  return out;
}
