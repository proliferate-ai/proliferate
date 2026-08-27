/**
 * DEV-ONLY LIGHT-MODE PROFILES — never ships, never merges.
 *
 * Each profile is a candidate light-mode direction expressed as overrides of
 * existing token names, projected by `scripts/generate-profiles.mjs` as
 * `:root[data-mode="light"][data-theme-profile="<name>"]` blocks — the same
 * mechanism rungs use. Flip between directions in a running app with:
 *
 *   document.documentElement.setAttribute("data-mode", "light")
 *   document.documentElement.setAttribute("data-theme-profile", "paper")
 *
 * The winning profile's values collapse into the real `light` halves in
 * `tokens.ts`/`palette.ts` (the theming PR); this file and its generator are
 * then deleted. Status hues (success/destructive/warning/info) never move.
 *
 * Shadow overrides target the `--elevation-*` twins (the `--shadow-*` names
 * are aliases the generator points at them).
 */

export interface ThemeProfile {
  /** One-line intent, shown in the generated CSS comment. */
  readonly intent: string;
  readonly tokens: Readonly<Record<string, string>>;
}

/** Warm near-black ink for the `paper` profile. */
const WARM_INK = "30, 27, 22"; // #1e1b16
/** The shipped cool ink. */
const COOL_INK = "26, 28, 31"; // #1a1c1f

const warm = (a: number) => `rgba(${WARM_INK}, ${a})`;
const cool = (a: number) => `rgba(${COOL_INK}, ${a})`;

/** Codex-reference ink (#0d0d0d), from the reference UI's own light tokens. */
const CODEX_INK = "13, 13, 13";
const codex = (a: number) => `rgba(${CODEX_INK}, ${a})`;

export const themeProfiles: Readonly<Record<string, ThemeProfile>> = {
  /**
   * CODEX. Very white but clean, after the reference UI: #0d0d0d ink, a
   * near-white #f9f9f9 rail separated by a hairline rather than a plane
   * step, quiet borders, airy state washes, white bordered composer with a
   * soft ambient lift. Reference values: text #0d0d0d / #5d5d5d, sidebar
   * #f9f9f9, message surface #f4f4f4 (the bubble fill needs a
   * `--color-user-message-surface` token at fold-in; today it rides bg-card).
   */
  codex: {
    intent: "very white, hairline-separated, quiet — after the reference UI",
    tokens: {
      "--color-foreground": "#0d0d0d",
      "--color-primary": "#0d0d0d",
      // One white plane for shell, sidebar, header and content: the header
      // band shows the rail through it, so any rail tint reads as a
      // header-vs-chat seam (found live 2026-08-26). Hairlines + washes
      // carry the structure instead, as in the reference UI.
      "--color-surface-under": "#ffffff",
      "--color-sidebar": "#ffffff",
      "--color-sidebar-background": "#ffffff",
      "--color-surface-editor": "#fafafa",
      "--color-composer-background": "#ffffff",
      // Stronger than the first cut: with every plane white, the hairlines
      // are the only structure, so they must actually read (the panel
      // divider was invisible at 13%).
      "--color-border-light": codex(0.125),
      "--color-border": codex(0.15),
      "--color-border-heavy": codex(0.19),
      "--color-input": codex(0.2),
      "--color-foreground-secondary": codex(0.64),
      "--color-muted-foreground": codex(0.64),
      "--color-foreground-tertiary": codex(0.6),
      "--color-faint": codex(0.6),
      "--color-sidebar-foreground": codex(0.88),
      "--color-sidebar-muted-foreground": codex(0.6),
      "--color-surface-elevated-secondary": codex(0.04),
      "--color-muted": codex(0.04),
      "--color-surface-control": codex(0.04),
      "--color-hover": codex(0.05),
      "--color-selected": codex(0.065),
      "--color-active": codex(0.08),
      // The reference user bubble: filled #f4f4f4 pill, no border, no lift.
      "--color-user-message-surface": "#f4f4f4",
      "--color-user-message-border": "transparent",
      "--elevation-user-message": "none",
      "--elevation-subtle": `0 1px 2px ${codex(0.04)}`,
      "--elevation-popover": `0 0 0 0.5px ${codex(0.05)}, 0 4px 16px ${codex(0.08)}`,
      "--elevation-modal": `0 24px 48px ${codex(0.16)}`,
      // Reference composer: slightly squarer corner than ours, one faint
      // hairline, barely-there lift — the frame recedes, the content leads.
      "--radius-composer": "1.5rem",
      "--elevation-composer": `0 0 0 1px ${codex(0.08)}, 0 4px 16px ${codex(0.05)}`,
    },
  },

  /**
   * A — PAPER. Warm the entire neutral field: warm ink, warm planes, so the
   * product reads like print rather than a spreadsheet. Same 3-plane model.
   */
  paper: {
    intent: "warm ink + warm planes; print-like, calm",
    tokens: {
      "--color-foreground": "#1e1b16",
      "--color-primary": "#1e1b16",
      "--color-surface": "#fbfaf7",
      "--color-surface-elevated": "#fffefb",
      "--color-card": "#fffefb",
      "--color-popover": "#fffefb",
      "--color-surface-under": "#f2efe9",
      "--color-sidebar": "#f2efe9",
      "--color-sidebar-background": "#f2efe9",
      "--color-composer-background": "#f2efe9",
      "--color-surface-editor": "#f7f4ef",
      "--color-border-light": warm(0.12),
      "--color-border": warm(0.15),
      "--color-border-heavy": warm(0.19),
      "--color-input": warm(0.21),
      "--color-foreground-secondary": warm(0.68),
      "--color-muted-foreground": warm(0.68),
      "--color-foreground-tertiary": warm(0.65),
      "--color-faint": warm(0.65),
      "--color-sidebar-foreground": warm(0.87),
      "--color-sidebar-muted-foreground": warm(0.65),
      "--color-surface-elevated-secondary": warm(0.055),
      "--color-muted": warm(0.055),
      "--color-surface-control": warm(0.055),
      "--color-hover": warm(0.055),
      "--color-selected": warm(0.07),
      "--color-active": warm(0.085),
      "--elevation-subtle": `0 1px 2px ${warm(0.06)}`,
      "--elevation-popover": `0 0 0 0.5px ${warm(0.05)}, 0 4px 12px ${warm(0.1)}`,
      "--elevation-modal": `0 16px 40px ${warm(0.18)}`,
      "--elevation-composer": `0 0 0 1px ${warm(0.19)}, 0 2px 5px ${warm(0.1)}, 0 8px 20px ${warm(0.07)}`,
      "--elevation-user-message": `0 1px 2px ${warm(0.05)}`,
    },
  },

  /**
   * B — STRUCTURED. Give light a real surface ladder the way dark has one:
   * #edeff2 → #f3f4f6 → #f8f9fa → #ffffff, crisper borders, decisive states.
   * The composer leaves the rail and becomes a white bordered plane.
   */
  structured: {
    intent: "4-plane cool ladder; crisp borders, decisive states",
    tokens: {
      "--color-surface-under": "#edeff2",
      "--color-sidebar-background": "#edeff2",
      "--color-sidebar": "#f3f4f6",
      "--color-surface-editor": "#f8f9fa",
      "--color-surface": "#ffffff",
      "--color-composer-background": "#ffffff",
      "--color-border-light": cool(0.13),
      "--color-border": cool(0.16),
      "--color-border-heavy": cool(0.22),
      "--color-input": cool(0.24),
      "--color-foreground-secondary": cool(0.67),
      "--color-muted-foreground": cool(0.67),
      "--color-foreground-tertiary": cool(0.64),
      "--color-faint": cool(0.64),
      "--color-sidebar-muted-foreground": cool(0.64),
      "--color-surface-elevated-secondary": cool(0.06),
      "--color-muted": cool(0.06),
      "--color-surface-control": cool(0.06),
      "--color-hover": cool(0.06),
      "--color-selected": cool(0.08),
      "--color-active": cool(0.1),
      "--elevation-subtle": `0 1px 2px ${cool(0.08)}`,
      "--elevation-popover": `0 0 0 0.5px ${cool(0.07)}, 0 4px 10px ${cool(0.12)}`,
      "--elevation-modal": `0 12px 32px ${cool(0.2)}`,
      "--elevation-composer": `0 0 0 1px ${cool(0.22)}, 0 2px 4px ${cool(0.08)}, 0 6px 16px ${cool(0.06)}`,
    },
  },

  /**
   * C — SOFT DEPTH. Keep the 3-plane model but carry separation with
   * ink-tinted shadow instead of borders: hairlines fade, lifts strengthen,
   * the composer floats as a white plane on white with no perimeter.
   */
  "soft-depth": {
    intent: "3 planes, faded borders, separation by ink-tinted shadow",
    tokens: {
      "--color-surface-under": "#f8f8f8",
      "--color-sidebar": "#f8f8f8",
      "--color-sidebar-background": "#f8f8f8",
      "--color-composer-background": "#ffffff",
      "--color-border-light": cool(0.115),
      "--color-border": cool(0.135),
      "--color-border-heavy": cool(0.16),
      "--color-input": cool(0.18),
      "--color-foreground-tertiary": cool(0.65),
      "--color-faint": cool(0.65),
      "--color-sidebar-muted-foreground": cool(0.65),
      "--color-hover": cool(0.06),
      "--color-selected": cool(0.075),
      "--color-active": cool(0.09),
      "--elevation-subtle": `0 1px 3px ${cool(0.09)}`,
      "--elevation-popover": `0 0 0 0.5px ${cool(0.04)}, 0 8px 24px ${cool(0.12)}`,
      "--elevation-modal": `0 24px 64px ${cool(0.22)}`,
      "--elevation-composer": `0 1px 2px ${cool(0.06)}, 0 6px 16px ${cool(0.08)}, 0 16px 40px ${cool(0.06)}`,
      "--elevation-user-message": `0 1px 3px ${cool(0.07)}`,
    },
  },
};
