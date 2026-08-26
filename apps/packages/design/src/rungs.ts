/**
 * Density and radius rungs: the two geometry axes the product selects as a
 * whole rather than per surface.
 *
 * A rung is a complete set of values for its axis. The `default` rung is what
 * every surface renders today — the theme tokens in `tokens.ts` read their
 * geometry from it, so the token values and the rung are one record, not two
 * numbers kept in step by hand. Any rung other than `default` is projected by
 * `scripts/generate-theme.mjs` as an attribute-scoped override block
 * (`:root[data-radius="<rung>"] { … }`) that re-points the same tokens; the app
 * selects a rung by setting that attribute on the document element, exactly as
 * `data-mode` selects the light palette. Nothing sets either attribute today,
 * and no alternate rung is populated: which rung the product sits on, and what
 * the alternates look like, is a founder decision recorded in
 * `specs/DESIGN_SYSTEM.md` ("Decisions reserved for the founder"). Populating
 * one is a values-only change here; the generator, the checker and every
 * consumer already understand it.
 */

export interface RadiusRung {
  readonly sm: string;
  readonly md: string;
  readonly lg: string;
  readonly xl: string;
  readonly "2xl": string;
}

export interface DensityRung {
  /** The single interactive-control height (`--height-control`). */
  readonly controlHeight: string;
  readonly iconButtonSm: string;
  readonly iconButtonMd: string;
  readonly iconButtonLg: string;
  /** Vertical rhythm between top-level transcript turns. */
  readonly transcriptTurnGap: string;
  /** Tight intra-turn grouping rhythm. */
  readonly transcriptTurnGapTight: string;
}

/** Which theme token each rung key drives. The generator and checker both read this map. */
export const rungTokens = {
  radius: {
    sm: "--radius-sm",
    md: "--radius-md",
    lg: "--radius-lg",
    xl: "--radius-xl",
    "2xl": "--radius-2xl",
  },
  density: {
    controlHeight: "--height-control",
    iconButtonSm: "--size-icon-button-sm",
    iconButtonMd: "--size-icon-button-md",
    iconButtonLg: "--size-icon-button-lg",
    transcriptTurnGap: "--spacing-transcript-turn",
    transcriptTurnGapTight: "--spacing-transcript-turn-tight",
  },
} as const;

/** The document-element attributes that select a rung. */
export const rungAttributes = {
  radius: "data-radius",
  density: "data-density",
} as const;

/** Radius grows with the element: 6 → 8 → 10 → 12 → 16px across the named steps. */
export const radiusRungs = {
  default: {
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.625rem",
    xl: "0.75rem",
    "2xl": "1rem",
  },
} as const satisfies Record<string, RadiusRung>;

export const densityRungs = {
  default: {
    controlHeight: "1.75rem",
    iconButtonSm: "1.25rem",
    iconButtonMd: "1.5rem",
    iconButtonLg: "1.75rem",
    transcriptTurnGap: "1rem",
    transcriptTurnGapTight: "0.25rem",
  },
} as const satisfies Record<string, DensityRung>;

export type RadiusRungName = keyof typeof radiusRungs;
export type DensityRungName = keyof typeof densityRungs;
