/**
 * Literal authority for Proliferate's web, code, motion, and native design
 * inputs. Generated CSS (`dist/theme.css`), the React Native bridge, and the
 * Shiki/Monaco palettes are all projections of these records; no CSS source
 * file may introduce a second global token value.
 *
 * Three layers, one direction: the raw layer (`palette.ts` — physical colors
 * by ramp and rung; `rungs.ts` — the geometry rung the product sits on) feeds
 * the semantic roles here, which feed the component tokens here. A role picks
 * a rung; a component picks roles. `layer` on each entry records which of the
 * two emitted layers it is, and `scripts/check-theme.mjs` enforces the
 * direction.
 *
 * Provenance tags record each value's disposition during the 2026-07
 * foundation consolidation:
 *   [SHIPPED]                 current rendered winner survives verbatim
 *   [SHIPPED:raw-hex-move]    shipped literal relocated into authority
 *   [SHIPPED:motion/authority] shipped cadence, value now owned by motion.ts
 *   [RETUNE:<ruling>]         enumerated deliberate change
 */
import { motion } from "./motion.js";
import { palette } from "./palette.js";
import { densityRungs, radiusRungs } from "./rungs.js";

/**
 * The layer a token belongs to. `semantic` tokens are the role vocabulary
 * every surface composes from (`--color-border`, `--radius-md`,
 * `--duration-enter`); they may only paint with colors the raw layer
 * (`palette.ts`) owns and may only reference other semantic tokens.
 * `component` tokens are one component's anatomy (`--color-composer-*`,
 * `--diff-view-*`, `--workspace-shell-*`) and may carry their own
 * special-purpose literals. The raw layer itself is never emitted as a token.
 */
export type TokenLayer = "semantic" | "component";

export interface ThemeTokenValue {
  readonly dark: string;
  readonly light: string;
  readonly layer: TokenLayer;
  readonly provenance: string;
  /**
   * Tailwind's `@theme` block cannot hold `color-mix()`, so every
   * `color-mix()` value carries the resolved literal used in the `@theme`
   * half. The runtime `:root` halves keep the relative `color-mix()` form.
   */
  readonly themeFallback?: string;
}

/** Final global CSS values, including all newly ruled canonical entries. */
export const themeTokens = {
  "--activity-dot-cell-breathe-cycle": {
    dark: motion.cssMs(2200),
    light: motion.cssMs(2200),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-helix-column-step": {
    dark: motion.cssMs(470),
    light: motion.cssMs(470),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-helix-cycle": {
    dark: motion.cssMs(1400),
    light: motion.cssMs(1400),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-helix-row-step": {
    dark: motion.cssMs(160),
    light: motion.cssMs(160),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-orbit-cycle": {
    dark: motion.cssMs(1150),
    light: motion.cssMs(1150),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-orbit-step": {
    dark: motion.cssMs(140),
    light: motion.cssMs(140),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-scan-cycle": {
    dark: motion.cssMs(1300),
    light: motion.cssMs(1300),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-scan-step": {
    dark: motion.cssMs(160),
    light: motion.cssMs(160),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-wave-cycle": {
    dark: motion.cssMs(1700),
    light: motion.cssMs(1700),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-dot-cell-wave-step": {
    dark: motion.cssMs(100),
    light: motion.cssMs(100),
    provenance: "[TABS:dot-cell-motion]", layer: "component",
  },
  "--activity-stream-reveal-fade": {
    dark: motion.cssMs(motion.activity.streamRevealFadeMs),
    light: motion.cssMs(motion.activity.streamRevealFadeMs),
    provenance: "[SHIPPED:motion/authority]", layer: "semantic",
  },
  "--animate-popover-in": {
    dark: "popover-in var(--duration-enter) var(--ease-out-quint)",
    light: "popover-in var(--duration-enter) var(--ease-out-quint)",
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--diff-view-context-number": {
    dark: "color-mix(in lab, var(--diff-view-surface) 98.5%, var(--diffs-mixer))",
    light: "color-mix(in srgb, #ffffff 96.5%, #1a1c1f)",
    themeFallback: "#292929",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diff-view-context-surface": {
    dark: "color-mix(in srgb, var(--diff-view-surface) 94%, var(--color-diff-main-surface))",
    light: "color-mix(in srgb, #ffffff 97.5%, #1a1c1f)",
    themeFallback: "#252525",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diff-view-header-surface": {
    dark: "var(--color-diff-header-surface)",
    light: "var(--color-diff-header-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diff-view-hover-surface": {
    dark: "color-mix(in srgb, var(--diff-view-surface) 92%, var(--color-diff-main-surface))",
    light: "color-mix(in srgb, #ffffff 91%, #1a1c1f)",
    themeFallback: "#252525",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diff-view-separator-surface": {
    dark: "color-mix(in srgb, var(--diff-view-surface) 94%, var(--color-foreground))",
    light: "color-mix(in srgb, #ffffff 88%, #1a1c1f)",
    themeFallback: "#333333",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diff-view-surface": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-accent-foreground": {
    dark: palette.paper,
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-active": {
    dark: palette.paperMix(5.2),
    light: palette.inkAlpha(0.078),
    themeFallback: palette.paperAlpha(0.052),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-background": {
    dark: palette.neutral.dark[3],
    light: palette.paper,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-border": {
    dark: palette.paperMix(8.4),
    light: palette.inkAlpha(0.14),
    themeFallback: palette.paperAlpha(0.084),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-border-heavy": {
    dark: palette.paperMix(12),
    light: palette.inkAlpha(0.18),
    themeFallback: palette.paperAlpha(0.12),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-border-light": {
    dark: palette.paperMix(5),
    light: palette.inkAlpha(0.114),
    themeFallback: palette.paperAlpha(0.05),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-card": {
    dark: palette.neutral.dark[4],
    light: palette.paper,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-card-foreground": {
    dark: palette.paper,
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-code-block-background": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-composer-backdrop-filter": {
    dark: "none",
    light: "none",
    provenance: "[RETUNE:surface/composer-opaque]", layer: "component",
  },
  /**
   * The composer is a fully opaque input surface — no transcript bleed-
   * through, in either mode. Dark keeps the lifted-gray `#2d2d2d` hue
   * `--color-surface-control` already uses; light keeps its shipped white.
   * Both render at 100% alpha now, so `--color-composer-backdrop-filter`
   * (below) has nothing left to blur and is set to `none` in both modes.
   */
  "--color-composer-background": {
    dark: palette.neutral.dark[8],
    // Light reuses the sanctioned rail plane #f6f6f6
    // (--color-surface-under / --color-sidebar) rather than adding a fourth
    // opaque light plane. Its shared border-role hairline makes the perimeter
    // legible without restoring elevation; dark keeps the stronger
    // #181818 → #2d2d2d fill step and no perimeter paint.
    light: palette.neutral.light[2],
    provenance: "[RETUNE:surface/composer-fill]", layer: "component",
  },
  "--color-composer-control-active-foreground": {
    dark: "var(--color-foreground)",
    light: "var(--color-foreground)",
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "component",
  },
  "--color-composer-control-foreground": {
    dark: "var(--color-muted-foreground)",
    light: "var(--color-muted-foreground)",
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "component",
  },
  "--color-composer-control-muted-foreground": {
    dark: "var(--color-faint)",
    light: "var(--color-faint)",
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "component",
  },
  "--color-composer-send-background": {
    dark: "var(--color-foreground)",
    light: "var(--color-primary)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-composer-send-foreground": {
    dark: "var(--color-background)",
    light: "var(--color-primary-foreground)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-compute-target-amber": {
    dark: "#b59a3a",
    light: "#b59a3a",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-blue": {
    dark: "#4a72b5",
    light: "#4a72b5",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-green": {
    dark: "#4a8d5a",
    light: "#4a8d5a",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-orange": {
    dark: "#b56b3a",
    light: "#b56b3a",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-pink": {
    dark: "#b0567c",
    light: "#b0567c",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-purple": {
    dark: "#7a5ab0",
    light: "#7a5ab0",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-red": {
    dark: "#b04444",
    light: "#b04444",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-slate": {
    dark: "#6b7280",
    light: "#6b7280",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-compute-target-teal": {
    dark: "#3c8a86",
    light: "#3c8a86",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-delegated-agent-1": {
    dark: "hsl(213 94% 68%)",
    light: "hsl(221 83% 53%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-delegated-agent-2": {
    dark: "hsl(292 100% 78%)",
    light: "hsl(292 100% 46%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-delegated-agent-3": {
    dark: "hsl(0 91% 71%)",
    light: "hsl(0 72% 51%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-delegated-agent-4": {
    dark: "hsl(50 100% 75%)",
    light: "hsl(36 95% 42%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-delegated-agent-5": {
    dark: "hsl(265 88% 78%)",
    light: "hsl(265 80% 55%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-delegated-agent-6": {
    dark: "hsl(188 85% 59%)",
    light: "hsl(192 90% 36%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-delegated-agent-7": {
    dark: "hsl(24 95% 72%)",
    light: "hsl(25 95% 46%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-delegated-agent-8": {
    dark: "hsl(199 89% 68%)",
    light: "hsl(199 89% 42%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-destructive": {
    dark: palette.red.base,
    light: palette.red.deep,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-destructive-foreground": {
    dark: palette.paper,
    light: palette.paper,
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-destructive-subtle": {
    dark: "rgba(250,66,62,0.12)",
    light: palette.red.tint,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-diff-added": {
    dark: "var(--color-git-green)",
    light: "var(--color-git-green)",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]", layer: "component",
  },
  "--color-diff-chat-file-header-hover-surface": {
    dark: "color-mix(in srgb, var(--color-diff-chat-file-header-surface) 97%, var(--color-foreground))",
    light: "color-mix(in srgb, #ffffff 91%, #1a1c1f)",
    themeFallback: palette.neutral.dark[8],
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--color-diff-chat-file-header-surface": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-diff-chat-inline-tool-header-hover-surface": {
    dark: "color-mix(in srgb, var(--color-diff-chat-inline-tool-header-surface) 97%, var(--color-foreground))",
    light: "color-mix(in srgb, #ffffff 91%, #1a1c1f)",
    themeFallback: palette.neutral.dark[6],
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--color-diff-chat-inline-tool-header-surface": {
    dark: "color-mix(in srgb, var(--color-diff-surface) 86%, var(--color-overlay))",
    light: "var(--color-diff-surface)",
    themeFallback: palette.neutral.dark[4],
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-diff-chat-turn-header-surface": {
    dark: "color-mix(in srgb, var(--color-diff-surface) 86%, var(--color-overlay))",
    light: "var(--color-diff-surface)",
    themeFallback: palette.neutral.dark[4],
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-diff-chat-turn-icon-surface": {
    dark: "color-mix(in srgb, var(--color-background) 88%, var(--color-overlay))",
    light: "color-mix(in srgb, #ffffff 91%, #1a1c1f)",
    themeFallback: "#151515",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--color-diff-code-surface": {
    dark: palette.neutral.dark[1],
    light: "var(--color-surface-editor)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-diff-deleted": {
    dark: "var(--color-git-red)",
    light: "var(--color-git-red)",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]", layer: "component",
  },
  "--color-diff-header-surface": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-diff-main-surface": {
    dark: palette.neutral.dark[3],
    light: "var(--color-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-diff-panel-surface": {
    dark: palette.paperMix(3),
    light: palette.inkAlpha(0.03),
    themeFallback: palette.paperAlpha(0.03),
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--color-diff-sidebar-file-header-hover-surface": {
    dark: "color-mix(in srgb, var(--color-diff-sidebar-file-header-surface) 97%, var(--color-foreground))",
    light: "color-mix(in srgb, #ffffff 91%, #1a1c1f)",
    themeFallback: palette.neutral.dark[6],
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--color-diff-sidebar-file-header-surface": {
    dark: "var(--color-diff-chat-inline-tool-header-surface)",
    light: "var(--color-diff-chat-inline-tool-header-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-diff-surface": {
    dark: "color-mix(in srgb, #181818 94%, #ffffff)",
    light: "color-mix(in srgb, #ffffff 95%, #1a1c1f)",
    themeFallback: "#262626",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  /**
   * The faintest legible ink. Light is authored against the darkest plane it
   * lands on, including the alpha control fill over white. The reference
   * proposal's 55% ink resolved to only 3.74:1 there; 62% clears the 4.5:1
   * floor on every measured light plane without introducing an opaque gray.
   */
  "--color-faint": {
    dark: palette.paperMix(50),
    light: palette.inkAlpha(0.62),
    themeFallback: palette.paperAlpha(0.5),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-file-icon-accent": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-file-icon-folder": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-file-icon-muted": {
    dark: "hsl(0 0% 64%)",
    light: "hsl(0 0% 43%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-file-icon-neutral": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-file-icon-red": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-foreground": {
    dark: palette.paper,
    light: palette.ink,
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-foreground-secondary": {
    dark: palette.paperMix(70),
    light: palette.inkAlpha(0.65),
    themeFallback: palette.paperAlpha(0.7),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  // Same tier as `--color-faint`, including its darkest-plane contrast floor.
  "--color-foreground-tertiary": {
    dark: palette.paperMix(50),
    light: palette.inkAlpha(0.62),
    themeFallback: palette.paperAlpha(0.5),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-git-green": {
    dark: palette.green.base,
    light: palette.green.deep,
    provenance: "[RETUNE:light/independent-scale]", layer: "component",
  },
  "--color-git-red": {
    dark: palette.red.base,
    light: palette.red.deep,
    provenance: "[RETUNE:light/independent-scale]", layer: "component",
  },
  "--color-git-yellow": {
    dark: palette.yellow.base,
    light: palette.yellow.deep,
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-highlight": {
    dark: "rgba(51, 156, 255, 0.12)",
    light: palette.blue.tint,
    provenance: "[RETUNE:light/single-accent]", layer: "semantic",
  },
  "--color-highlight-muted": {
    dark: "rgba(51, 156, 255, 0.5)",
    light: palette.blue.deep,
    provenance: "[RETUNE:light/single-accent]", layer: "semantic",
  },
  "--color-hover": {
    dark: palette.paperMix(7.8),
    light: palette.inkAlpha(0.053),
    themeFallback: palette.paperAlpha(0.078),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-info": {
    dark: palette.blue.base,
    light: palette.blue.deep,
    provenance: "[RETUNE:light/single-accent]", layer: "semantic",
  },
  "--color-input": {
    dark: palette.paperMix(12),
    light: palette.inkAlpha(0.2),
    themeFallback: palette.paperAlpha(0.12),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  // Dark uses a lighter blue so prose links remain legible on #181818. Light
  // joins the single #0b6bcb accent used by focus, info, and special roles.
  // This remains one link token with no per-surface variants.
  "--color-link-foreground": {
    dark: palette.blue.soft,
    light: palette.blue.deep,
    provenance: "[RETUNE:light/single-accent]", layer: "semantic",
  },
  "--color-muted": {
    dark: palette.neutral.dark[4],
    light: palette.inkAlpha(0.049),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-muted-foreground": {
    dark: palette.paperMix(70),
    light: palette.inkAlpha(0.65),
    themeFallback: palette.paperAlpha(0.7),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-overlay": {
    dark: palette.black,
    light: palette.black,
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-popover": {
    dark: palette.neutral.dark[8],
    light: palette.paper,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-popover-foreground": {
    dark: palette.paper,
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-pr-merged": {
    dark: palette.violet.base,
    light: palette.violet.deep,
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-primary": {
    dark: palette.paper,
    light: palette.ink,
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-primary-foreground": {
    dark: palette.neutral.dark[0],
    light: palette.paper,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-prose-border": {
    dark: palette.paperMix(8),
    light: "var(--color-border-heavy)",
    themeFallback: palette.paperAlpha(0.08),
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-ring": {
    dark: palette.paperMix(28),
    light: palette.blue.deep,
    themeFallback: palette.paperAlpha(0.28),
    provenance: "[RETUNE:light/single-accent]", layer: "semantic",
  },
  "--color-scrollbar-thumb": {
    dark: palette.paperAlpha(0.08),
    light: palette.inkAlpha(0.12),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-scrollbar-thumb-active": {
    dark: palette.paperAlpha(0.16),
    light: palette.inkAlpha(0.24),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-secondary-foreground": {
    dark: palette.paper,
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-selected": {
    dark: palette.paperMix(3.2),
    light: palette.inkAlpha(0.065),
    themeFallback: palette.paperAlpha(0.032),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-sidebar": {
    // Round-2 measurement against the reference app's dark capture: the
    // sidebar rail reads rgb(34, 34, 34) — one step LIGHTER than the root
    // surface, not recessed to --color-surface-under. Supersedes the
    // surface-recess ruling from the prior retune.
    dark: palette.neutral.dark[5],
    light: palette.neutral.light[2],
    provenance: "[RETUNE:light/two-plane-system]", layer: "semantic",
  },
  "--color-sidebar-accent-foreground": {
    dark: palette.paper,
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-sidebar-background": {
    dark: palette.neutral.dark[3],
    light: palette.neutral.light[2],
    provenance: "[RETUNE:light/two-plane-system]", layer: "semantic",
  },
  "--color-sidebar-foreground": {
    dark: palette.paperMix(85),
    light: palette.inkAlpha(0.85),
    themeFallback: palette.paperAlpha(0.85),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-sidebar-muted-foreground": {
    dark: palette.paperAlpha(0.481),
    light: palette.inkAlpha(0.62),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-sidebar-primary": {
    dark: palette.paper,
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-sidebar-ring": {
    dark: "rgba(127, 193, 255, 0.747)",
    light: "var(--color-ring)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-sidebar-status-error": {
    dark: "rgb(255 100 89)",
    light: palette.red.deep,
    provenance: "[SIDEBAR:status-system]", layer: "component",
  },
  "--color-sidebar-status-unseen": {
    dark: "rgb(108 184 255)",
    light: palette.blue.deep,
    provenance: "[SIDEBAR:status-system]", layer: "component",
  },
  "--color-sidebar-status-waiting": {
    dark: "rgb(255 180 50)",
    light: palette.amber.deep,
    provenance: "[SIDEBAR:status-system]", layer: "component",
  },
  "--color-sidebar-status-worktree": {
    dark: "rgb(173 123 249)",
    light: palette.violet.deep,
    provenance: "[SIDEBAR:status-system]", layer: "component",
  },
  "--color-special": {
    dark: palette.blue.base,
    light: palette.blue.deep,
    provenance: "[RETUNE:light/single-accent]", layer: "semantic",
  },
  /**
   * [RETUNE:color/special-foreground] — the accent had no paired text color, so
   * the first filled accent control (the sidebar's update affordance) had no
   * legal way to name its glyph color: the palette resets stock Tailwind colors,
   * so `text-white` compiles to nothing, and `--color-primary-foreground`
   * inverts with the mode while the accent does not. The accent fill is
   * mode-independent, so its paired foreground is too.
   */
  "--color-special-foreground": {
    dark: palette.paper,
    light: palette.paper,
    provenance: "[RETUNE:color/special-foreground]", layer: "semantic",
  },
  "--color-status-in-progress": {
    dark: palette.amber.soft,
    light: palette.amber.deep,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-success": {
    dark: palette.green.base,
    light: palette.green.deep,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-success-subtle": {
    dark: "rgba(64,201,119,0.14)",
    light: palette.green.tint,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-surface": {
    dark: palette.neutral.dark[3],
    light: palette.paper,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  /**
   * Control fill. Unlike `--color-surface` / `--color-card`, this role does NOT
   * collapse to white in light mode: 41 of its 62 call sites paint no border or
   * ring — the queued-message banner, the permission-request block, the todo
   * progress track whose entire affordance is its fill — so the fill is the only
   * thing that separates the control from the pane behind it. One step off white
   * (the same value the `muted` / `elevated-secondary` fills carry) keeps that
   * step visible without asking every call site to grow an edge.
   */
  "--color-surface-control": {
    dark: "color-mix(in oklab, #2b2b2b 96%, transparent)",
    light: palette.inkAlpha(0.049),
    themeFallback: "rgba(43, 43, 43, 0.96)",
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-surface-editor": {
    dark: palette.neutral.dark[6],
    light: palette.neutral.light[1],
    provenance: "[RETUNE:light/two-plane-system]", layer: "semantic",
  },
  "--color-surface-elevated": {
    dark: palette.neutral.dark[4],
    light: palette.paper,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-surface-elevated-secondary": {
    dark: palette.paperMix(3),
    light: palette.inkAlpha(0.049),
    themeFallback: palette.paperAlpha(0.03),
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "semantic",
  },
  "--color-surface-under": {
    dark: palette.neutral.dark[2],
    light: palette.neutral.light[2],
    provenance: "[RETUNE:light/two-plane-system]", layer: "semantic",
  },
  /**
   * Keyword ink for the Appearance pane's hand-drawn code preview.
   *
   * A live role rather than a literal in `themePreviewColors`, because unlike
   * the theme-card artwork this ink paints on the *current* mode's surfaces and
   * must flip with them. Dark `#FB5D8F` is the shipped pink; the light half is
   * darkened to `#C7175C` because the shipped pink measures 2.97:1 on white,
   * under the 4.5:1 floor. Measured light ratios: 5.67:1 on `--color-background`
   * (#ffffff), 4.94:1 on the addition tint (#e4f3ea) and 4.84:1 on the deletion
   * tint (#fbe9e8) — the two diff surfaces the preview actually paints it over.
   */
  "--color-syntax-keyword": {
    dark: "#FB5D8F",
    light: "#C7175C",
    provenance: "[RETUNE:light/independent-scale]", layer: "component",
  },
  "--color-terminal-black": {
    dark: palette.paperAlpha(0.5),
    light: "#545a61",
    provenance: "[RETUNE:light/independent-scale]", layer: "component",
  },
  "--color-terminal-blue": {
    dark: palette.blue.base,
    light: "#001bcb",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-black": {
    dark: palette.paperAlpha(0.71),
    light: palette.black,
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-blue": {
    dark: palette.blue.base,
    light: "#006aff",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-cyan": {
    dark: palette.blue.base,
    light: "#20b8ff",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-green": {
    dark: palette.green.base,
    light: "#59d24e",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-magenta": {
    dark: palette.violet.base,
    light: "#9840ff",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-red": {
    dark: palette.red.soft,
    light: "#f44a4c",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-white": {
    dark: palette.paper,
    light: "#828282",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-bright-yellow": {
    dark: palette.yellow.base,
    light: "#f87915",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-cyan": {
    dark: palette.blue.base,
    light: "#0071ea",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-green": {
    dark: palette.green.base,
    light: "#008809",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-magenta": {
    dark: palette.violet.base,
    light: "#751ed9",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-red": {
    dark: palette.red.soft,
    light: "#d53538",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-white": {
    dark: palette.paper,
    light: "#666666",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-terminal-yellow": {
    dark: palette.yellow.base,
    light: "#bd5800",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--color-text-caret": {
    dark: "var(--color-foreground)",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-text-selection": {
    dark: "var(--color-highlight, var(--color-input))",
    light: "var(--color-highlight, var(--color-input))",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  /**
   * The user-message bubble's edge, which only one mode needs.
   *
   * `--color-card` is #212121 on the #181818 pane in dark, so the fill alone
   * already separates the bubble and a border would be surplus chrome. In light
   * the card is #ffffff on a #ffffff pane, so the fill separates nothing and the
   * edge is the only thing carrying the shape. Same component, opposite needs —
   * so the difference lives in a token rather than a `dark:` variant.
   */
  "--color-user-message-border": {
    dark: "transparent",
    light: "var(--color-border)",
    provenance: "[RETUNE:light/independent-scale]", layer: "component",
  },
  "--color-warning": {
    dark: "rgba(255, 180, 50, 0.15)",
    light: palette.amber.tint,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-warning-border": {
    dark: "rgba(255, 180, 50, 0.25)",
    light: palette.amber.edge,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-warning-foreground": {
    dark: palette.amber.base,
    light: palette.amber.deep,
    provenance: "[RETUNE:light/independent-scale]", layer: "semantic",
  },
  "--color-warning-subtle": {
    dark: "rgba(242,201,76,0.14)",
    light: "rgba(242,201,76,0.14)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--color-window-control-close": {
    dark: "#ff5f57",
    light: "#ff5f57",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  "--color-window-control-minimize": {
    dark: "#febc2e",
    light: "#febc2e",
    provenance: "[SHIPPED:raw-hex-move]", layer: "component",
  },
  /**
   * Narrow 40rem measure for prose-heavy surfaces outside the unified chat
   * flow. Named in Tailwind's `--container-*` namespace so consumers can use
   * `max-w-transcript-readable` instead of an arbitrary bracket width.
   */
  "--container-transcript-readable": {
    dark: "40rem",
    light: "40rem",
    provenance: "[RETUNE:layout/transcript-measure]", layer: "component",
  },
  /**
   * Shared 48rem chat column for the launch composer, active composer, and
   * transcript. The narrower readable token remains available to prose-heavy
   * surfaces outside this unified chat flow.
   */
  "--container-transcript-thread": {
    dark: "48rem",
    light: "48rem",
    provenance: "[RETUNE:layout/transcript-measure]", layer: "component",
  },
  "--container-transcript-wide": {
    dark: "56rem",
    light: "56rem",
    provenance: "[RETUNE:layout/transcript-measure]", layer: "component",
  },
  "--diffs-addition-color-override": {
    dark: "var(--color-diff-added)",
    light: "var(--color-diff-added)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-bg-addition-hover-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 82%, var(--color-diff-added))",
    light: "#d3ebdd",
    themeFallback: "#14311f",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diffs-bg-addition-number-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 91%, var(--color-diff-added))",
    light: "#d9eee2",
    themeFallback: "#16241c",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diffs-bg-addition-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 88%, var(--color-diff-added))",
    light: "#e4f3ea",
    themeFallback: "#15291d",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diffs-bg-context-override": {
    dark: "var(--diff-view-context-surface)",
    light: "var(--diff-view-context-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-bg-deletion-hover-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 82%, var(--color-diff-deleted))",
    light: "#f7d7d5",
    themeFallback: "#3c1c1b",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diffs-bg-deletion-number-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 91%, var(--color-diff-deleted))",
    light: "#f9dfdd",
    themeFallback: "#2a1a1a",
    provenance: "[RETUNE:light/white-anchored-diffs]", layer: "component",
  },
  "--diffs-bg-deletion-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 88%, var(--color-diff-deleted))",
    light: palette.red.tint,
    themeFallback: "#301b1a",
    provenance: "[RETUNE:light/independent-scale]", layer: "component",
  },
  "--diffs-bg-separator-override": {
    dark: "var(--diff-view-separator-surface)",
    light: "var(--diff-view-separator-surface)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-deletion-color-override": {
    dark: "var(--color-diff-deleted)",
    light: "var(--color-diff-deleted)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-fg": {
    dark: "#fcfcfc",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-font-family": {
    dark: "var(--font-mono)",
    light: "var(--font-mono)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-font-size": {
    // Coupled to the "Reading & code" default: follows the 14px UI-text
    // default minus 1px for mono optics (ui-foundation appearance ruling).
    dark: "13px",
    light: "13px",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-line-height": {
    dark: "calc(var(--diffs-font-size, 13px) * 1.8)",
    light: "calc(var(--diffs-font-size, 13px) * 1.8)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-min-number-column-width": {
    dark: "4ch",
    light: "4ch",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--diffs-mixer": {
    dark: "#fcfcfc",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--duration-disclosure": {
    dark: motion.cssMs(motion.duration.disclosureMs),
    light: motion.cssMs(motion.duration.disclosureMs),
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--duration-dissolve": {
    dark: motion.cssMs(motion.duration.dissolveMs),
    light: motion.cssMs(motion.duration.dissolveMs),
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--duration-emphasized": {
    dark: motion.cssMs(motion.duration.emphasizedMs),
    light: motion.cssMs(motion.duration.emphasizedMs),
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--duration-enter": {
    dark: motion.cssMs(motion.duration.enterMs),
    light: motion.cssMs(motion.duration.enterMs),
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--duration-exit": {
    dark: motion.cssMs(motion.duration.exitMs),
    light: motion.cssMs(motion.duration.exitMs),
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--duration-hover": {
    dark: motion.cssMs(motion.duration.hoverMs),
    light: motion.cssMs(motion.duration.hoverMs),
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--duration-panel": {
    dark: motion.cssMs(motion.duration.panelMs),
    light: motion.cssMs(motion.duration.panelMs),
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--duration-pop": {
    dark: motion.cssMs(motion.duration.popMs),
    light: motion.cssMs(motion.duration.popMs),
    provenance: "[AGENT-OPERATIONS:spawn-receipt-motion]", layer: "semantic",
  },
  "--ease-linear": {
    dark: motion.ease.linear,
    light: motion.ease.linear,
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--ease-out-cubic": {
    dark: motion.ease.outCubic,
    light: motion.ease.outCubic,
    provenance: "[RETUNE:motion/level-bar-cadence]", layer: "semantic",
  },
  "--ease-out-quint": {
    dark: motion.ease.outQuint,
    light: motion.ease.outQuint,
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--ease-pop": {
    dark: motion.ease.pop,
    light: motion.ease.pop,
    provenance: "[AGENT-OPERATIONS:spawn-receipt-motion]", layer: "semantic",
  },
  "--ease-spring": {
    dark: motion.ease.spring,
    light: motion.ease.spring,
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--ease-standard": {
    dark: motion.ease.standard,
    light: motion.ease.standard,
    provenance: "[RETUNE:motion/roles]", layer: "semantic",
  },
  "--font-mono": {
    dark: "\"Geist Mono\", ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
    light: "\"Geist Mono\", ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--font-sans": {
    dark: "-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, \"Segoe UI\", sans-serif",
    light: "-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, \"Segoe UI\", sans-serif",
    provenance: "[RETUNE:type/Geist] — trial: native system stack; Geist variant preserved in git history, swap back = revert this value", layer: "semantic",
  },
  /**
   * Base document weight. `product.css`'s `body` rule reads this token
   * instead of a bare literal so the value stays single-sourced here.
   */
  "--font-weight-body": {
    dark: "445",
    light: "445",
    provenance: "[RETUNE:type/body-weight]", layer: "semantic",
  },
  "--font-weight-control": {
    dark: "450",
    light: "450",
    provenance: "[RETUNE:type/control-weight]", layer: "semantic",
  },
  /**
   * The single interactive-control height. Every compact control that sits in a
   * row with its peers — composer model/mode/integration/add-file/send buttons,
   * segmented controls, header pills, settings toggles — is 28px tall at the
   * same 13px `--text-ui` label. The composer already shipped that height at
   * ~70 call sites, so this token names the shipped winner rather than
   * introducing a new one; `--size-icon-button-lg` and
   * `--workspace-shell-action-size` are the same 1.75rem, which is the
   * agreement this tier makes reusable instead of re-derived per surface.
   *
   * Deliberately NOT em, unlike the `--icon-*` tiers directly below. An em is
   * right for a glyph because a glyph belongs to the text it sits in: the
   * callsite's font-size IS its intended scale reference, so `--icon-paired`
   * tracks whatever role labels that particular control. A control BOX has the
   * opposite relationship. It is a row-level agreement between siblings that
   * carry DIFFERENT text roles (a `--text-ui` picker beside a `--text-ui-sm`
   * pill beside an icon-only button with no label at all), so resolving its
   * height against each callsite's own font-size produces a ragged row at a
   * single appearance preference — the exact drift this tier exists to end.
   * rem also keeps the box on the unchanged html root (see the `body` rule in
   * product.css), so the UI font-size presets retune glyphs and labels inside a
   * stable control rhythm, and window zoom still scales the whole geometry.
   *
   * Lives in Tailwind's `--height-*` namespace, which generates exactly
   * `h-control` / `min-h-control` / `max-h-control` and nothing else. The
   * `--spacing-*` namespace would also emit `w-`/`p-`/`gap-control`, offering a
   * 28px gap and a 28px pad that no rule here sanctions.
   */
  "--height-control": {
    dark: densityRungs.default.controlHeight,
    light: densityRungs.default.controlHeight,
    provenance: "[RETUNE:controls/unified-28px-height]", layer: "semantic",
  },
  "--icon-compact": {
    dark: "1em",
    light: "1em",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--icon-control": {
    dark: "1.333333em",
    light: "1.333333em",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--icon-display": {
    dark: "2em",
    light: "2em",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  /**
   * Sidebar row glyphs use the row text's 13px optical size inside their
   * larger alignment wells. Keeping this role separate from `--icon-compact`
   * lets the sidebar remain independently tunable even though both currently
   * resolve to the same ratio.
   */
  "--icon-indicator": {
    dark: "1em",
    light: "1em",
    provenance: "[RETUNE:icons/sidebar-indicator]", layer: "semantic",
  },
  "--icon-large": {
    dark: "1.666667em",
    light: "1.666667em",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--icon-paired": {
    dark: "1.230769em",
    light: "1.230769em",
    provenance: "[RETUNE:icons/16px-paired]", layer: "semantic",
  },
  "--icon-status": {
    dark: "0.55em",
    light: "0.55em",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  /**
   * [RETUNE:icons/sidebar-trailing-tight] — round-4 sidebar feedback: the
   * trailing plus/three-dots row controls (`SidebarActionButton`, the
   * sidebar's `RowActionIconButton` kebab) rendered their glyph at
   * `--icon-control` (16px), which read 50-60% too big against the
   * reference sidebar on screen even though the ratio math looked correct.
   * `0.875em` lands at 11.4px against the sidebar row's 13px text — the
   * smallest inline-glyph tier, reserved for these row-trailing controls
   * whose 24px hit box is unusually large relative to their glyph.
   */
  "--icon-tight": {
    dark: "0.875em",
    light: "0.875em",
    provenance: "[RETUNE:icons/sidebar-trailing-tight]", layer: "semantic",
  },
  "--radius": {
    dark: radiusRungs.default.md,
    light: radiusRungs.default.md,
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--radius-2xl": {
    dark: radiusRungs.default['2xl'],
    light: radiusRungs.default['2xl'],
    provenance: "[RETUNE:radii/soft-scale]", layer: "semantic",
  },
  "--radius-composer": {
    dark: "1.75rem",
    light: "1.75rem",
    provenance: "[RETUNE:radii/composer-soft]", layer: "component",
  },
  "--radius-full": {
    dark: "9999px",
    light: "9999px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--radius-lg": {
    dark: radiusRungs.default.lg,
    light: radiusRungs.default.lg,
    provenance: "[RETUNE:radii/soft-scale]", layer: "semantic",
  },
  "--radius-md": {
    dark: radiusRungs.default.md,
    light: radiusRungs.default.md,
    provenance: "[RETUNE:radii/soft-scale]", layer: "semantic",
  },
  "--radius-sm": {
    dark: radiusRungs.default.sm,
    light: radiusRungs.default.sm,
    provenance: "[RETUNE:radii/soft-scale]", layer: "semantic",
  },
  "--radius-xl": {
    dark: radiusRungs.default.xl,
    light: radiusRungs.default.xl,
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--readable-code-font-size": {
    // Coupled to the "Reading & code" default: follows the 14px UI-text
    // default minus 1px for mono optics (ui-foundation appearance ruling).
    dark: "13px",
    light: "13px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--readable-code-line-height": {
    dark: "1.625",
    light: "1.625",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--scratch-code-font-family": {
    dark: "var(--font-mono)",
    light: "var(--font-mono)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--scratch-font-family": {
    dark: "var(--font-sans)",
    light: "var(--font-sans)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--scratch-font-size": {
    dark: "var(--text-message, var(--text-chat, 14px))",
    light: "var(--text-message, var(--text-chat, 14px))",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--scratch-line-height": {
    dark: "var(--text-message--line-height, var(--text-chat--line-height, 22px))",
    light: "var(--text-message--line-height, var(--text-chat--line-height, 22px))",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--scratch-list-marker-leading-space": {
    dark: "0.48em",
    light: "0.48em",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--scratch-task-box-size": {
    dark: "0.82em",
    light: "0.82em",
    provenance: "[SHIPPED]", layer: "component",
  },
  /**
   * The light composer needs both a clear perimeter and controlled lift to
   * read as an available input against the white transcript canvas. Dark
   * already has a strong surface step, so adding shadow there would change its
   * established appearance. Keep the whole depth recipe in one mode-responsive
   * role so component CSS never reconstructs it from literals.
   */
  "--shadow-composer": {
    dark: "none",
    light: "0 0 0 1px var(--color-border-heavy), 0 2px 5px rgba(26, 28, 31, 0.10), 0 8px 20px rgba(26, 28, 31, 0.07)",
    provenance: "[RETUNE:light/composer-separation]", layer: "component",
  },
  "--shadow-modal": {
    dark: "0 25px 50px -12px rgb(0 0 0 / 0.5)",
    light: "0 16px 40px rgba(26, 28, 31, 0.18)",
    provenance: "[RETUNE:light/ink-tinted-elevation]", layer: "semantic",
  },
  "--shadow-popover": {
    dark: "0 4px 12px rgb(0 0 0 / 0.12)",
    light: "0 0 0 0.5px rgba(26, 28, 31, 0.05), 0 4px 12px rgba(26, 28, 31, 0.1)",
    provenance: "[RETUNE:light/ink-tinted-elevation]", layer: "semantic",
  },
  "--shadow-subtle": {
    dark: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    light: "0 1px 2px rgba(26, 28, 31, 0.06)",
    provenance: "[RETUNE:light/ink-tinted-elevation]", layer: "semantic",
  },
  /**
   * Lift for the user-message bubble, which only light mode needs — see
   * `--color-user-message-border` for why the two modes differ here. Lives in
   * the `--shadow-*` namespace because that is what generates the `shadow-*`
   * utility; a `--color-*` name would emit no rule and fail silently.
   */
  "--shadow-user-message": {
    dark: "none",
    light: "0 1px 2px rgba(26, 28, 31, 0.05)",
    provenance: "[RETUNE:light/ink-tinted-elevation]", layer: "component",
  },
  "--size-icon-button-lg": {
    dark: densityRungs.default.iconButtonLg,
    light: densityRungs.default.iconButtonLg,
    provenance: "[RETUNE:icons/control-boxes]", layer: "semantic",
  },
  "--size-icon-button-md": {
    dark: densityRungs.default.iconButtonMd,
    light: densityRungs.default.iconButtonMd,
    provenance: "[RETUNE:icons/control-boxes]", layer: "semantic",
  },
  "--size-icon-button-sm": {
    dark: densityRungs.default.iconButtonSm,
    light: densityRungs.default.iconButtonSm,
    provenance: "[RETUNE:icons/control-boxes]", layer: "semantic",
  },
  /**
   * Vertical rhythm between top-level transcript turns: a 16px gap, tokenized
   * rather than left to each consuming layout. Lives in Tailwind's
   * `--spacing-*` namespace so `gap-transcript-turn` (and `mt-`/`p-`/`py-` on
   * the same name) resolves without an arbitrary gap value, which the
   * appearance gate bans. Note Tailwind v4 does NOT derive `space-y-*` from
   * the spacing namespace, so a `space-y-4` turn stack converts to a flex
   * column with `gap-transcript-turn`, not to a `space-y-` variant of this
   * name.
   */
  "--spacing-transcript-turn": {
    dark: densityRungs.default.transcriptTurnGap,
    light: densityRungs.default.transcriptTurnGap,
    provenance: "[RETUNE:layout/transcript-measure]", layer: "component",
  },
  /**
   * Tight intra-turn grouping (e.g. a prose block and its immediately
   * following action row) — deliberately smaller than
   * `--spacing-transcript-turn` so turn-to-turn rhythm and within-turn
   * rhythm read as two distinct rungs, not one shared gap.
   */
  "--spacing-transcript-turn-tight": {
    dark: densityRungs.default.transcriptTurnGapTight,
    light: densityRungs.default.transcriptTurnGapTight,
    provenance: "[RETUNE:layout/transcript-measure]", layer: "component",
  },
  "--text-body": {
    dark: "14px",
    light: "14px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-body--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-body--line-height": {
    dark: "21px",
    light: "21px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-body-emphasis": {
    dark: "15px",
    light: "15px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-body-emphasis--letter-spacing": {
    dark: "-0.005em",
    light: "-0.005em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-body-emphasis--line-height": {
    dark: "22px",
    light: "22px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-chat": {
    dark: "14px",
    light: "14px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-chat--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-chat--line-height": {
    dark: "22px",
    light: "22px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-chat-meta": {
    dark: "calc(var(--text-chat, 14px) - 2px)",
    light: "calc(var(--text-chat, 14px) - 2px)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-composer": {
    dark: "14px",
    light: "14px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-composer--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-composer--line-height": {
    dark: "20px",
    light: "20px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-heading": {
    dark: "17px",
    light: "17px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-heading--letter-spacing": {
    dark: "var(--tracking-heading)",
    light: "var(--tracking-heading)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-heading--line-height": {
    dark: "24px",
    light: "24px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-hero": {
    dark: "26px",
    light: "26px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-hero--letter-spacing": {
    dark: "var(--tracking-tight)",
    light: "var(--tracking-tight)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-hero--line-height": {
    dark: "34px",
    light: "34px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-message": {
    dark: "var(--text-chat)",
    light: "var(--text-chat)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-message--letter-spacing": {
    dark: "var(--text-chat--letter-spacing)",
    light: "var(--text-chat--letter-spacing)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-message--line-height": {
    dark: "var(--text-chat--line-height)",
    light: "var(--text-chat--line-height)",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  /**
   * Inline code sits slightly under its surrounding prose. Expressed in `em`
   * (not a fixed px size) so it scales with whatever `--markdown-font-size`
   * the enclosing message has set, instead of pinning a literal size the
   * appearance gate would flag.
   */
  "--text-markdown-inline-code": {
    dark: "0.92em",
    light: "0.92em",
    provenance: "[RETUNE:type/markdown-heading-ramp]", layer: "component",
  },
  /**
   * Markdown heading ramp multipliers consumed by authenticated.css's
   * `.chat-markdown` scope. h1 stays anchored on the semantic `--text-title`
   * role and h2 stays the midpoint of `--text-title`/body (no magic
   * literal in either); h3/h4 are unitless multipliers of
   * `--markdown-font-size`, tokenized here instead of living as bare
   * literals in authenticated.css. h5/h6 stay at 1x (no additional
   * scale-up), matching the reference's compact micro-heading treatment.
   */
  "--markdown-heading-h3-scale": {
    dark: "1.1667",
    light: "1.1667",
    provenance: "[RETUNE:type/markdown-heading-ramp]", layer: "component",
  },
  "--markdown-heading-h4-scale": {
    dark: "1.0833",
    light: "1.0833",
    provenance: "[RETUNE:type/markdown-heading-ramp]", layer: "component",
  },
  "--text-readable-code": {
    dark: "var(--readable-code-font-size)",
    light: "var(--readable-code-font-size)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-readable-code--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-readable-code--line-height": {
    dark: "var(--readable-code-line-height)",
    light: "var(--readable-code-line-height)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-sidebar-brand": {
    dark: "17px",
    light: "17px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-sidebar-brand--letter-spacing": {
    dark: "var(--tracking-heading)",
    light: "var(--tracking-heading)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-sidebar-brand--line-height": {
    dark: "24px",
    light: "24px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-sidebar-nav": {
    dark: "13px",
    light: "13px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-sidebar-nav--letter-spacing": {
    dark: "0.005em",
    light: "0.005em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-sidebar-nav--line-height": {
    dark: "18px",
    light: "18px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-sidebar-row": {
    dark: "13px",
    light: "13px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-sidebar-row--letter-spacing": {
    dark: "0.005em",
    light: "0.005em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-sidebar-row--line-height": {
    dark: "18px",
    light: "18px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-title": {
    dark: "19px",
    light: "19px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-title--letter-spacing": {
    dark: "var(--tracking-tight)",
    light: "var(--tracking-tight)",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-title--line-height": {
    dark: "24px",
    light: "24px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-ui": {
    dark: "13px",
    light: "13px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-ui--letter-spacing": {
    dark: "0.005em",
    light: "0.005em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-ui--line-height": {
    dark: "18px",
    light: "18px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-ui-sm": {
    dark: "12px",
    light: "12px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-ui-sm--letter-spacing": {
    dark: "0.01em",
    light: "0.01em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-ui-sm--line-height": {
    dark: "16px",
    light: "16px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-workspace-title": {
    dark: "15px",
    light: "15px",
    provenance: "[SHIPPED]", layer: "semantic",
  },
  "--text-workspace-title--letter-spacing": {
    dark: "-0.005em",
    light: "-0.005em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--text-workspace-title--line-height": {
    dark: "22px",
    light: "22px",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--tracking-heading": {
    dark: "-0.01em",
    light: "-0.01em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--tracking-tight": {
    dark: "-0.025em",
    light: "-0.025em",
    provenance: "[RETUNE:type/closed-ramp]", layer: "semantic",
  },
  "--workspace-shell-action-background": {
    dark: "transparent",
    light: "transparent",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-action-border": {
    dark: "var(--color-border)",
    light: "var(--color-border)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-action-font-size": {
    dark: "var(--text-ui-sm)",
    light: "var(--text-ui-sm)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-action-font-weight": {
    dark: "var(--font-weight-control)",
    light: "var(--font-weight-control)",
    provenance: "[RETUNE:type/control-weight]", layer: "component",
  },
  "--workspace-shell-action-foreground": {
    dark: "var(--color-muted-foreground)",
    light: "var(--color-muted-foreground)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-action-hover-foreground": {
    dark: "var(--color-foreground)",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-action-line-height": {
    dark: "var(--text-ui-sm--line-height)",
    light: "var(--text-ui-sm--line-height)",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-action-radius": {
    dark: "0.5rem",
    light: "0.5rem",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-action-size": {
    dark: "1.75rem",
    light: "1.75rem",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-tab-active-background": {
    dark: "transparent",
    light: "transparent",
    provenance: "[RETUNE:header/unboxed-tabs]", layer: "component",
  },
  "--workspace-shell-tab-active-border": {
    dark: "transparent",
    light: "transparent",
    provenance: "[RETUNE:header/unboxed-tabs]", layer: "component",
  },
  "--workspace-shell-tab-active-underline": {
    dark: "rgb(255 255 255)",
    light: "var(--color-foreground)",
    provenance: "[RETUNE:light/alpha-neutral-system]", layer: "component",
  },
  "--workspace-shell-tab-active-underline-size": {
    dark: "2px",
    light: "2px",
    provenance: "[TABS:active-underline]", layer: "component",
  },
  "--workspace-shell-tab-close-collapse": {
    dark: "tab-close-collapse var(--duration-enter) var(--ease-out-quint) both",
    light: "tab-close-collapse var(--duration-enter) var(--ease-out-quint) both",
    provenance: "[RETUNE:header/tab-close-slide]", layer: "component",
  },
  "--workspace-shell-tab-content-gap": {
    dark: "0.4375rem",
    light: "0.4375rem",
    provenance: "[TABS:activity-gap]", layer: "component",
  },
  "--workspace-shell-tab-font-size": {
    dark: "12.5px",
    light: "12.5px",
    provenance: "[TABS:reference-geometry]", layer: "component",
  },
  "--workspace-shell-tab-height": {
    dark: "100%",
    light: "100%",
    provenance: "[TABS:reference-geometry]", layer: "component",
  },
  "--workspace-shell-tab-inline-padding": {
    dark: "13px",
    light: "13px",
    provenance: "[TABS:reference-geometry]", layer: "component",
  },
  "--workspace-shell-tab-inactive-background": {
    dark: "transparent",
    light: "transparent",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-tab-inactive-border": {
    dark: "transparent",
    light: "transparent",
    provenance: "[SHIPPED]", layer: "component",
  },
  "--workspace-shell-tab-radius": {
    dark: "0.375rem",
    light: "0.375rem",
    provenance: "[RETUNE:radii/soft-scale]", layer: "component",
  },
  "--workspace-shell-tab-selected-background": {
    dark: "var(--color-selected)",
    light: "var(--color-selected)",
    provenance: "[RETUNE:header/unboxed-tabs]", layer: "component",
  },
  "--workspace-shell-tab-selected-border": {
    dark: "transparent",
    light: "transparent",
    provenance: "[RETUNE:header/unboxed-tabs]", layer: "component",
  },
  "--workspace-shell-tab-status-size": {
    dark: "13px",
    light: "13px",
    provenance: "[TABS:trailing-status]", layer: "component",
  },
  "--workspace-shell-tab-shortcut-block-padding": {
    dark: "2px",
    light: "2px",
    provenance: "[TABS:shortcut-badge]", layer: "component",
  },
  "--workspace-shell-tab-shortcut-font-size": {
    dark: "9.5px",
    light: "9.5px",
    provenance: "[TABS:shortcut-badge]", layer: "component",
  },
  "--workspace-shell-tab-shortcut-inline-padding": {
    dark: "5px",
    light: "5px",
    provenance: "[TABS:shortcut-badge]", layer: "component",
  },
  "--workspace-shell-tab-shortcut-line-height": {
    dark: "11px",
    light: "11px",
    provenance: "[TABS:shortcut-badge]", layer: "component",
  },
  "--workspace-shell-tab-shortcut-radius": {
    dark: "4px",
    light: "4px",
    provenance: "[TABS:shortcut-badge]", layer: "component",
  },
  "--z-base": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
  "--z-overlay": {
    dark: "40",
    light: "40",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
  "--z-popover": {
    dark: "50",
    light: "50",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
  "--z-raised": {
    dark: "10",
    light: "10",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
  "--z-sticky": {
    dark: "20",
    light: "20",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
  "--z-toast": {
    dark: "60",
    light: "60",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
  "--z-tooltip": {
    dark: "70",
    light: "70",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
  "--z-top": {
    dark: "80",
    light: "80",
    provenance: "[RETUNE:layering/scale]", layer: "semantic",
  },
} as const satisfies Record<string, ThemeTokenValue>;

export type ThemeTokenName = keyof typeof themeTokens;

function darkValue(name: ThemeTokenName): string {
  return themeTokens[name].dark;
}

function cssPixels(name: ThemeTokenName): number {
  const value = darkValue(name);
  if (value.endsWith("px")) return Number.parseFloat(value);
  if (value.endsWith("rem")) return Number.parseFloat(value) * 16;
  throw new Error(`Expected a CSS length for ${name}, received ${value}`);
}

/** Resolve a token to a literal React Native can consume (no var/color-mix). */
function nativeColor(name: ThemeTokenName): string {
  const token: ThemeTokenValue = themeTokens[name];
  if (token.themeFallback) return token.themeFallback;
  const alias = token.dark.match(/^var\((--[a-z0-9-]+)\)$/);
  if (alias?.[1] && alias[1] in themeTokens) {
    return nativeColor(alias[1] as ThemeTokenName);
  }
  return token.dark;
}

/**
 * React Native-compatible dark palette. Roles shared with the web project from
 * the authority above; only genuinely mobile-only roles stay authored here.
 */
export const colors = {
  background: nativeColor("--color-background"),
  foreground: nativeColor("--color-foreground"),
  overlay: nativeColor("--color-overlay"),
  // Mobile-only scrim strength; the retired web --color-overlay-strong stays absent.
  overlayStrong: "rgba(0,0,0,0.58)",
  primary: nativeColor("--color-primary"),
  primaryForeground: nativeColor("--color-primary-foreground"),
  secondary: nativeColor("--color-muted"),
  secondaryForeground: nativeColor("--color-secondary-foreground"),
  accent: nativeColor("--color-hover"),
  accentForeground: nativeColor("--color-accent-foreground"),
  muted: nativeColor("--color-muted"),
  mutedForeground: nativeColor("--color-muted-foreground"),
  faint: nativeColor("--color-faint"),
  helper: nativeColor("--color-muted-foreground"),
  card: nativeColor("--color-card"),
  cardForeground: nativeColor("--color-card-foreground"),
  popover: nativeColor("--color-popover"),
  popoverForeground: nativeColor("--color-popover-foreground"),
  popoverAccent: nativeColor("--color-hover"),
  popoverRing: nativeColor("--color-border"),
  border: nativeColor("--color-border"),
  borderLight: nativeColor("--color-border-light"),
  borderHeavy: nativeColor("--color-border-heavy"),
  input: nativeColor("--color-input"),
  ring: nativeColor("--color-ring"),
  surface: nativeColor("--color-surface"),
  surfaceControl: nativeColor("--color-surface-control"),
  surfaceElevated: nativeColor("--color-surface-elevated"),
  destructive: nativeColor("--color-destructive"),
  destructiveSubtle: nativeColor("--color-destructive-subtle"),
  destructiveForeground: nativeColor("--color-destructive-foreground"),
  success: nativeColor("--color-success"),
  successSubtle: nativeColor("--color-success-subtle"),
  successForeground: nativeColor("--color-foreground"),
  warning: nativeColor("--color-warning"),
  warningSubtle: nativeColor("--color-warning-subtle"),
  warningForeground: nativeColor("--color-warning-foreground"),
  info: nativeColor("--color-info"),
  // Mobile-only semantic tint retained for native notice surfaces.
  infoSubtle: "rgba(51,156,255,0.14)",
  infoForeground: nativeColor("--color-foreground"),
  sidebar: nativeColor("--color-sidebar"),
  sidebarBackground: nativeColor("--color-sidebar-background"),
  sidebarForeground: nativeColor("--color-sidebar-foreground"),
  sidebarMutedForeground: nativeColor("--color-sidebar-muted-foreground"),
  sidebarAccent: nativeColor("--color-hover"),
  sidebarAccentForeground: nativeColor("--color-sidebar-accent-foreground"),
  sidebarBorder: nativeColor("--color-border"),
  sidebarBlue: nativeColor("--color-info"),
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: cssPixels("--radius-sm"),
  md: cssPixels("--radius-md"),
  lg: cssPixels("--radius-lg"),
  xl: cssPixels("--radius-xl"),
  "2xl": cssPixels("--radius-2xl"),
  full: cssPixels("--radius-full"),
} as const;

export const typography = {
  fontSans: darkValue("--font-sans"),
  fontMono: darkValue("--font-mono"),
  weight: {
    control: Number.parseFloat(darkValue("--font-weight-control")),
  },
  size: {
    uiSm: cssPixels("--text-ui-sm"),
    ui: cssPixels("--text-ui"),
    chat: cssPixels("--text-chat"),
    composer: cssPixels("--text-composer"),
    body: cssPixels("--text-body"),
    bodyEmphasis: cssPixels("--text-body-emphasis"),
    workspaceTitle: cssPixels("--text-workspace-title"),
    heading: cssPixels("--text-heading"),
    title: cssPixels("--text-title"),
    hero: cssPixels("--text-hero"),
    sidebarNav: cssPixels("--text-sidebar-nav"),
    sidebarRow: cssPixels("--text-sidebar-row"),
    sidebarBrand: cssPixels("--text-sidebar-brand"),
  },
  lineHeight: {
    uiSm: cssPixels("--text-ui-sm--line-height"),
    ui: cssPixels("--text-ui--line-height"),
    chat: cssPixels("--text-chat--line-height"),
    composer: cssPixels("--text-composer--line-height"),
    body: cssPixels("--text-body--line-height"),
    bodyEmphasis: cssPixels("--text-body-emphasis--line-height"),
    workspaceTitle: cssPixels("--text-workspace-title--line-height"),
    heading: cssPixels("--text-heading--line-height"),
    title: cssPixels("--text-title--line-height"),
    hero: cssPixels("--text-hero--line-height"),
    sidebarNav: cssPixels("--text-sidebar-nav--line-height"),
    sidebarRow: cssPixels("--text-sidebar-row--line-height"),
    sidebarBrand: cssPixels("--text-sidebar-brand--line-height"),
  },
  letterSpacing: {
    uiSm: darkValue("--text-ui-sm--letter-spacing"),
    ui: darkValue("--text-ui--letter-spacing"),
    chat: darkValue("--text-chat--letter-spacing"),
    composer: darkValue("--text-composer--letter-spacing"),
    body: darkValue("--text-body--letter-spacing"),
    bodyEmphasis: darkValue("--text-body-emphasis--letter-spacing"),
    workspaceTitle: darkValue("--text-workspace-title--letter-spacing"),
    heading: darkValue("--text-heading--letter-spacing"),
    title: darkValue("--text-title--letter-spacing"),
    hero: darkValue("--text-hero--letter-spacing"),
    sidebarNav: darkValue("--text-sidebar-nav--letter-spacing"),
    sidebarRow: darkValue("--text-sidebar-row--letter-spacing"),
    sidebarBrand: darkValue("--text-sidebar-brand--letter-spacing"),
  },
} as const;

export const shadows = {
  subtle: darkValue("--shadow-subtle"),
  popover: darkValue("--shadow-popover"),
  modal: darkValue("--shadow-modal"),
} as const;

/** Legacy native timing names remain stable while resolving to the ruled scale. */
export const timing = {
  fast: motion.duration.hoverMs,
  normal: motion.duration.enterMs,
  slow: motion.duration.panelMs,
} as const;

/**
 * Fills for the Appearance pane's theme preview illustrations.
 *
 * These are artwork, not palette. A theme card has to depict the mode it
 * selects — the Light card stays light while the app is in dark mode, and the
 * System card shows both halves at once — so its fills are deliberately
 * mode-independent and cannot resolve through the theme custom properties like
 * every other surface does. They live here for the same reason `codeColors`
 * does: the literals belong to the authority, never to a component.
 *
 * The two halves are the abstracted app, not sampled screenshots: a page
 * ground, a sheet floating on it, pill-shaped controls in two weights, and
 * hairline separators.
 */
export const themePreviewColors = {
  light: {
    ground: "#F0F0F0",
    sheet: "#FFFFFF",
    sheetAlt: "#F7F7F7",
    pillStrong: "#D4D4D4",
    pill: "#E4E4E4",
    hairline: "#F1F1F1",
  },
  dark: {
    ground: "#111111",
    // The System card's dark half sits one rung below the Dark card's ground so
    // the split reads as two surfaces rather than one interrupted one.
    groundSplit: "#0D0D0D",
    sheet: "#1C1C1C",
    pillStrong: "#3A3A3A",
    pill: "#2E2E2E",
    hairline: "#2A2A2A",
  },
} as const;

/**
 * Resolved code-palette inputs for the Shiki and Monaco adapters (§6). Editor
 * palettes carry their own literals because they are not DOM custom properties;
 * terminal roles project from the authority above.
 */
export const codeColors = {
  dark: {
    // Provenance: shipped Shiki dark palette (code-theme-tokens.ts pre-retune).
    foreground: "#FFFFFF",
    background: "#181818",
    muted: "#FFFFFF80",
    string: "#00A67D",
    heading: "#F22C3D",
    emphasis: "#DF3079",
    keyword: "#2E95D3",
    support: "#E9950C",
    selection: "#339CFF33",
    diffAdded: "#00A240",
    diffDeleted: "#E02E2A",
    gitGreen: "#40C977",
    gitRed: "#FA423E",
    gitYellow: "#FFD240",
  },
  light: {
    // Provenance: shipped Shiki light palette (code-theme-tokens.ts pre-retune).
    foreground: "#383A42",
    background: "#FFFFFF",
    muted: "#A0A1A7",
    string: "#50A14F",
    heading: "#E45649",
    emphasis: "#986801",
    keyword: "#A626A4",
    support: "#C18401",
    selection: "#339CFF33",
    diffAdded: "#00A240",
    diffDeleted: "#BA2623",
    gitGreen: "#00A240",
    gitRed: "#BA2623",
    gitYellow: "#FFC300",
  },
  terminal: {
    black: darkValue("--color-terminal-black"),
    red: darkValue("--color-terminal-red"),
    green: darkValue("--color-terminal-green"),
    yellow: darkValue("--color-terminal-yellow"),
    blue: darkValue("--color-terminal-blue"),
    magenta: darkValue("--color-terminal-magenta"),
    cyan: darkValue("--color-terminal-cyan"),
    white: darkValue("--color-terminal-white"),
    brightBlack: darkValue("--color-terminal-bright-black"),
    brightRed: darkValue("--color-terminal-bright-red"),
    brightGreen: darkValue("--color-terminal-bright-green"),
    brightYellow: darkValue("--color-terminal-bright-yellow"),
    brightBlue: darkValue("--color-terminal-bright-blue"),
    brightMagenta: darkValue("--color-terminal-bright-magenta"),
    brightCyan: darkValue("--color-terminal-bright-cyan"),
    brightWhite: darkValue("--color-terminal-bright-white"),
  },
} as const;

export const proliferateTokens = {
  theme: themeTokens,
  colors,
  spacing,
  radius,
  typography,
  shadows,
  motion,
  timing,
  codeColors,
} as const;
