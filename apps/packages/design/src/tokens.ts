/**
 * Literal authority for Proliferate's web, code, motion, and native design
 * inputs. Generated CSS (`dist/theme.css`), the React Native bridge, and the
 * Shiki/Monaco palettes are all projections of these records; no CSS source
 * file may introduce a second global token value.
 *
 * Provenance tags record each value's disposition during the 2026-07
 * foundation consolidation:
 *   [SHIPPED]                 current rendered winner survives verbatim
 *   [SHIPPED:raw-hex-move]    shipped literal relocated into authority
 *   [SHIPPED:motion/authority] shipped cadence, value now owned by motion.ts
 *   [RETUNE:<ruling>]         enumerated deliberate change
 */
import { motion } from "./motion.js";

export interface ThemeTokenValue {
  readonly dark: string;
  readonly light: string;
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
  "--activity-stream-reveal-fade": {
    dark: motion.cssMs(motion.activity.streamRevealFadeMs),
    light: motion.cssMs(motion.activity.streamRevealFadeMs),
    provenance: "[SHIPPED:motion/authority]",
  },
  "--activity-level-bar-step": {
    dark: motion.cssMs(motion.activity.levelBarStepMs),
    light: motion.cssMs(motion.activity.levelBarStepMs),
    provenance: "[SHIPPED:motion/authority]",
  },
  "--activity-update-ready-sweep": {
    dark: motion.cssMs(motion.activity.updateReadySweepMs),
    light: motion.cssMs(motion.activity.updateReadySweepMs),
    provenance: "[SHIPPED:motion/authority]",
  },
  "--animate-popover-in": {
    dark: "popover-in var(--duration-enter) var(--ease-out-quint)",
    light: "popover-in var(--duration-enter) var(--ease-out-quint)",
    provenance: "[RETUNE:motion/roles]",
  },
  "--diff-view-context-number": {
    dark: "color-mix(in lab, var(--diff-view-surface) 98.5%, var(--diffs-mixer))",
    light: "color-mix(in lab, var(--diff-view-surface) 98.5%, var(--diffs-mixer))",
    themeFallback: "#292929",
    provenance: "[SHIPPED]",
  },
  "--diff-view-context-surface": {
    dark: "color-mix(in srgb, var(--diff-view-surface) 94%, var(--color-diff-main-surface))",
    light: "color-mix(in srgb, var(--diff-view-surface) 94%, var(--color-diff-main-surface))",
    themeFallback: "#252525",
    provenance: "[SHIPPED]",
  },
  "--diff-view-header-surface": {
    dark: "var(--color-diff-header-surface)",
    light: "var(--color-diff-header-surface)",
    provenance: "[SHIPPED]",
  },
  "--diff-view-hover-surface": {
    dark: "color-mix(in srgb, var(--diff-view-surface) 92%, var(--color-diff-main-surface))",
    light: "color-mix(in srgb, var(--diff-view-surface) 92%, var(--color-diff-main-surface))",
    themeFallback: "#252525",
    provenance: "[SHIPPED]",
  },
  "--diff-view-separator-surface": {
    dark: "color-mix(in srgb, var(--diff-view-surface) 94%, var(--color-foreground))",
    light: "color-mix(in srgb, var(--diff-view-surface) 94%, var(--color-foreground))",
    themeFallback: "#333333",
    provenance: "[SHIPPED]",
  },
  "--diff-view-surface": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]",
  },
  "--color-accent-foreground": {
    dark: "#ffffff",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-active": {
    dark: "color-mix(in oklab, #ffffff 5.2%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 5.2%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.052)",
    provenance: "[RETUNE:state/overlay]",
  },
  "--color-background": {
    dark: "#181818",
    light: "#ffffff",
    provenance: "[SHIPPED]",
  },
  "--color-border": {
    dark: "color-mix(in oklab, #ffffff 8.4%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 8.4%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.084)",
    provenance: "[RETUNE:state/border]",
  },
  "--color-border-heavy": {
    dark: "color-mix(in oklab, #ffffff 12%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 12%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.12)",
    provenance: "[SHIPPED]",
  },
  "--color-border-light": {
    dark: "color-mix(in oklab, #ffffff 5%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 5%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.05)",
    provenance: "[SHIPPED]",
  },
  "--color-brand-logo-tile": {
    dark: "hsl(0 0% 100%)",
    light: "hsl(0 0% 100%)",
    provenance: "[SHIPPED]",
  },
  "--color-card": {
    dark: "#212121",
    light: "var(--color-surface-elevated)",
    provenance: "[SHIPPED]",
  },
  "--color-card-foreground": {
    dark: "#ffffff",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-code-block-background": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]",
  },
  "--color-composer-backdrop-filter": {
    dark: "none",
    light: "none",
    provenance: "[RETUNE:surface/composer-opaque]",
  },
  /**
   * The composer is a fully opaque input surface — no transcript bleed-
   * through, in either mode. Dark keeps the lifted-gray `#2d2d2d` hue
   * `--color-surface-control` already uses; light keeps its shipped white.
   * Both render at 100% alpha now, so `--color-composer-backdrop-filter`
   * (below) has nothing left to blur and is set to `none` in both modes.
   */
  "--color-composer-background": {
    dark: "#2d2d2d",
    light: "#ffffff",
    provenance: "[RETUNE:surface/composer-opaque]",
  },
  "--color-composer-control-active-foreground": {
    dark: "var(--color-foreground)",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-composer-control-foreground": {
    dark: "var(--color-muted-foreground)",
    light: "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
    provenance: "[SHIPPED]",
  },
  "--color-composer-control-muted-foreground": {
    dark: "var(--color-faint)",
    light: "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
    provenance: "[SHIPPED]",
  },
  "--color-composer-send-background": {
    dark: "var(--color-foreground)",
    light: "var(--color-primary)",
    provenance: "[SHIPPED]",
  },
  "--color-composer-send-foreground": {
    dark: "var(--color-background)",
    light: "var(--color-primary-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-composer-shadow": {
    dark: "var(--shadow-subtle)",
    light: "var(--shadow-subtle)",
    provenance: "[RETUNE:elevation/near-flat]",
  },
  "--color-compute-target-amber": {
    dark: "#b59a3a",
    light: "#b59a3a",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-blue": {
    dark: "#4a72b5",
    light: "#4a72b5",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-green": {
    dark: "#4a8d5a",
    light: "#4a8d5a",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-orange": {
    dark: "#b56b3a",
    light: "#b56b3a",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-pink": {
    dark: "#b0567c",
    light: "#b0567c",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-purple": {
    dark: "#7a5ab0",
    light: "#7a5ab0",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-red": {
    dark: "#b04444",
    light: "#b04444",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-slate": {
    dark: "#6b7280",
    light: "#6b7280",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-compute-target-teal": {
    dark: "#3c8a86",
    light: "#3c8a86",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-delegated-agent-1": {
    dark: "hsl(213 94% 68%)",
    light: "hsl(221 83% 53%)",
    provenance: "[SHIPPED]",
  },
  "--color-delegated-agent-2": {
    dark: "hsl(292 100% 78%)",
    light: "hsl(292 100% 46%)",
    provenance: "[SHIPPED]",
  },
  "--color-delegated-agent-3": {
    dark: "hsl(0 91% 71%)",
    light: "hsl(0 72% 51%)",
    provenance: "[SHIPPED]",
  },
  "--color-delegated-agent-4": {
    dark: "hsl(50 100% 75%)",
    light: "hsl(36 95% 42%)",
    provenance: "[SHIPPED]",
  },
  "--color-delegated-agent-5": {
    dark: "hsl(265 88% 78%)",
    light: "hsl(265 80% 55%)",
    provenance: "[SHIPPED]",
  },
  "--color-delegated-agent-6": {
    dark: "hsl(188 85% 59%)",
    light: "hsl(192 90% 36%)",
    provenance: "[SHIPPED]",
  },
  "--color-delegated-agent-7": {
    dark: "hsl(24 95% 72%)",
    light: "hsl(25 95% 46%)",
    provenance: "[SHIPPED]",
  },
  "--color-delegated-agent-8": {
    dark: "hsl(199 89% 68%)",
    light: "hsl(199 89% 42%)",
    provenance: "[SHIPPED]",
  },
  "--color-destructive": {
    dark: "#fa423e",
    light: "#e02e2a",
    provenance: "[SHIPPED]",
  },
  "--color-destructive-foreground": {
    dark: "#ffffff",
    light: "#ffffff",
    provenance: "[SHIPPED]",
  },
  "--color-destructive-subtle": {
    dark: "rgba(250,66,62,0.12)",
    light: "rgba(250,66,62,0.12)",
    provenance: "[SHIPPED]",
  },
  "--color-diff-added": {
    dark: "var(--color-git-green)",
    light: "var(--color-git-green)",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--color-diff-chat-file-header-hover-surface": {
    dark: "color-mix(in srgb, var(--color-diff-chat-file-header-surface) 97%, var(--color-foreground))",
    light: "color-mix(in srgb, var(--color-diff-chat-file-header-surface) 97%, var(--color-foreground))",
    themeFallback: "#2d2d2d",
    provenance: "[SHIPPED]",
  },
  "--color-diff-chat-file-header-surface": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]",
  },
  "--color-diff-chat-inline-tool-header-hover-surface": {
    dark: "color-mix(in srgb, var(--color-diff-chat-inline-tool-header-surface) 97%, var(--color-foreground))",
    light: "color-mix(in srgb, var(--color-diff-chat-inline-tool-header-surface) 97%, var(--color-foreground))",
    themeFallback: "#282828",
    provenance: "[SHIPPED]",
  },
  "--color-diff-chat-inline-tool-header-surface": {
    dark: "color-mix(in srgb, var(--color-diff-surface) 86%, var(--color-overlay))",
    light: "var(--color-diff-surface)",
    themeFallback: "#212121",
    provenance: "[SHIPPED]",
  },
  "--color-diff-chat-turn-header-surface": {
    dark: "color-mix(in srgb, var(--color-diff-surface) 86%, var(--color-overlay))",
    light: "var(--color-diff-surface)",
    themeFallback: "#212121",
    provenance: "[SHIPPED]",
  },
  "--color-diff-chat-turn-icon-surface": {
    dark: "color-mix(in srgb, var(--color-background) 88%, var(--color-overlay))",
    light: "color-mix(in srgb, var(--color-diff-main-surface) 94%, var(--color-foreground))",
    themeFallback: "#151515",
    provenance: "[SHIPPED]",
  },
  "--color-diff-code-surface": {
    dark: "#111111",
    light: "var(--color-surface-editor)",
    provenance: "[SHIPPED]",
  },
  "--color-diff-deleted": {
    dark: "var(--color-git-red)",
    light: "var(--color-git-red)",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--color-diff-header-surface": {
    dark: "var(--color-diff-surface)",
    light: "var(--color-diff-surface)",
    provenance: "[SHIPPED]",
  },
  "--color-diff-main-surface": {
    dark: "#181818",
    light: "var(--color-surface)",
    provenance: "[SHIPPED]",
  },
  "--color-diff-panel-surface": {
    dark: "color-mix(in oklab, #ffffff 3%, transparent)",
    light: "var(--color-surface-elevated-secondary)",
    themeFallback: "rgba(255, 255, 255, 0.03)",
    provenance: "[SHIPPED]",
  },
  "--color-diff-sidebar-file-header-hover-surface": {
    dark: "color-mix(in srgb, var(--color-diff-sidebar-file-header-surface) 97%, var(--color-foreground))",
    light: "color-mix(in srgb, var(--color-diff-sidebar-file-header-surface) 97%, var(--color-foreground))",
    themeFallback: "#282828",
    provenance: "[SHIPPED]",
  },
  "--color-diff-sidebar-file-header-surface": {
    dark: "var(--color-diff-chat-inline-tool-header-surface)",
    light: "var(--color-diff-chat-inline-tool-header-surface)",
    provenance: "[SHIPPED]",
  },
  "--color-diff-surface": {
    dark: "color-mix(in srgb, #181818 94%, #ffffff)",
    light: "color-mix(in srgb, var(--color-surface) 94%, var(--color-foreground))",
    themeFallback: "#262626",
    provenance: "[SHIPPED]",
  },
  "--color-faint": {
    dark: "color-mix(in oklab, #ffffff 50%, transparent)",
    light: "var(--color-foreground-tertiary)",
    themeFallback: "rgba(255, 255, 255, 0.5)",
    provenance: "[SHIPPED]",
  },
  "--color-file-icon-accent": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]",
  },
  "--color-file-icon-folder": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]",
  },
  "--color-file-icon-muted": {
    dark: "hsl(0 0% 64%)",
    light: "hsl(0 0% 43%)",
    provenance: "[SHIPPED]",
  },
  "--color-file-icon-neutral": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]",
  },
  "--color-file-icon-red": {
    dark: "hsl(0 0% 89%)",
    light: "hsl(0 0% 17%)",
    provenance: "[SHIPPED]",
  },
  "--color-foreground": {
    dark: "#ffffff",
    light: "#1a1c1f",
    provenance: "[SHIPPED]",
  },
  "--color-foreground-secondary": {
    dark: "color-mix(in oklab, #ffffff 70%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.7)",
    provenance: "[SHIPPED]",
  },
  "--color-foreground-tertiary": {
    dark: "color-mix(in oklab, #ffffff 50%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.5)",
    provenance: "[SHIPPED]",
  },
  "--color-git-green": {
    dark: "#40c977",
    light: "#00a240",
    provenance: "[SHIPPED]",
  },
  "--color-git-red": {
    dark: "#fa423e",
    light: "#ba2623",
    provenance: "[SHIPPED]",
  },
  "--color-git-yellow": {
    dark: "#ffd240",
    light: "#ffc300",
    provenance: "[SHIPPED]",
  },
  "--color-highlight": {
    dark: "rgba(51, 156, 255, 0.12)",
    light: "#e5f3ff",
    provenance: "[SHIPPED]",
  },
  "--color-highlight-muted": {
    dark: "rgba(51, 156, 255, 0.5)",
    light: "#339cff",
    provenance: "[SHIPPED]",
  },
  "--color-hover": {
    dark: "color-mix(in oklab, #ffffff 7.8%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 7.8%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.078)",
    provenance: "[RETUNE:state/overlay]",
  },
  "--color-info": {
    dark: "#339cff",
    light: "#0285ff",
    provenance: "[SHIPPED]",
  },
  "--color-input": {
    dark: "color-mix(in oklab, #ffffff 12%, transparent)",
    light: "var(--color-surface-control)",
    themeFallback: "rgba(255, 255, 255, 0.12)",
    provenance: "[SHIPPED]",
  },
  "--color-link-foreground": {
    dark: "#339cff",
    light: "#339cff",
    provenance: "[SHIPPED]",
  },
  "--color-muted": {
    dark: "#212121",
    light: "var(--color-surface-elevated-secondary)",
    provenance: "[SHIPPED]",
  },
  "--color-muted-foreground": {
    dark: "color-mix(in oklab, #ffffff 70%, transparent)",
    light: "var(--color-foreground-secondary)",
    themeFallback: "rgba(255, 255, 255, 0.7)",
    provenance: "[SHIPPED]",
  },
  "--color-overlay": {
    dark: "#000000",
    light: "#000000",
    provenance: "[SHIPPED]",
  },
  "--color-popover": {
    dark: "#2d2d2d",
    light: "#ffffff",
    provenance: "[SHIPPED]",
  },
  "--color-popover-foreground": {
    dark: "#ffffff",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-pr-merged": {
    dark: "#ad7bf9",
    light: "#8250df",
    provenance: "[SHIPPED]",
  },
  "--color-primary": {
    dark: "#ffffff",
    light: "#1a1c1f",
    provenance: "[SHIPPED]",
  },
  "--color-primary-foreground": {
    dark: "#0d0d0d",
    light: "#ffffff",
    provenance: "[SHIPPED]",
  },
  "--color-prose-border": {
    dark: "color-mix(in oklab, #ffffff 8%, transparent)",
    light: "var(--color-border-heavy)",
    themeFallback: "rgba(255, 255, 255, 0.08)",
    provenance: "[SHIPPED]",
  },
  "--color-ring": {
    dark: "color-mix(in oklab, #ffffff 28%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 30%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.28)",
    provenance: "[SHIPPED]",
  },
  "--color-scrollbar-thumb": {
    dark: "rgba(255, 255, 255, 0.08)",
    light: "rgba(13, 13, 13, 0.08)",
    provenance: "[SHIPPED]",
  },
  "--color-scrollbar-thumb-active": {
    dark: "rgba(255, 255, 255, 0.16)",
    light: "rgba(13, 13, 13, 0.16)",
    provenance: "[SHIPPED]",
  },
  "--color-secondary-foreground": {
    dark: "#ffffff",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-selected": {
    dark: "color-mix(in oklab, #ffffff 3.2%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 3.2%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.032)",
    provenance: "[RETUNE:state/overlay]",
  },
  "--color-sidebar": {
    // Round-2 measurement against the reference app's dark capture: the
    // sidebar rail reads rgb(34, 34, 34) — one step LIGHTER than the root
    // surface, not recessed to --color-surface-under. Supersedes the
    // surface-recess ruling from the prior retune.
    dark: "#222222",
    light: "var(--color-surface-under)",
    provenance: "[RETUNE:sidebar/reference-surface]",
  },
  "--color-sidebar-accent-foreground": {
    dark: "#ffffff",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-sidebar-background": {
    dark: "#181818",
    light: "var(--color-background)",
    provenance: "[SHIPPED]",
  },
  "--color-sidebar-foreground": {
    dark: "color-mix(in oklab, #ffffff 85%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 85%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.85)",
    provenance: "[SHIPPED]",
  },
  "--color-sidebar-muted-foreground": {
    dark: "rgba(255, 255, 255, 0.481)",
    light: "var(--color-foreground-tertiary)",
    provenance: "[SHIPPED]",
  },
  "--color-sidebar-primary": {
    dark: "#ffffff",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-sidebar-ring": {
    dark: "rgba(127, 193, 255, 0.747)",
    light: "var(--color-ring)",
    provenance: "[SHIPPED]",
  },
  "--color-special": {
    dark: "#339cff",
    light: "#339cff",
    provenance: "[SHIPPED]",
  },
  "--color-status-in-progress": {
    dark: "#ffcc33",
    light: "#bd5800",
    provenance: "[SHIPPED]",
  },
  "--color-success": {
    dark: "#40c977",
    light: "#00a240",
    provenance: "[SHIPPED]",
  },
  "--color-success-subtle": {
    dark: "rgba(64,201,119,0.14)",
    light: "rgba(64,201,119,0.14)",
    provenance: "[SHIPPED]",
  },
  "--color-surface": {
    dark: "#181818",
    light: "#ffffff",
    provenance: "[SHIPPED]",
  },
  "--color-surface-control": {
    dark: "color-mix(in oklab, #2b2b2b 96%, transparent)",
    light: "rgba(237, 237, 237, 0.4)",
    themeFallback: "rgba(43, 43, 43, 0.96)",
    provenance: "[SHIPPED]",
  },
  "--color-surface-editor": {
    dark: "#282828",
    light: "#f7f7f7",
    provenance: "[SHIPPED]",
  },
  "--color-surface-elevated": {
    dark: "#212121",
    light: "#ffffff",
    provenance: "[SHIPPED]",
  },
  "--color-surface-elevated-secondary": {
    dark: "color-mix(in oklab, #ffffff 3%, transparent)",
    light: "color-mix(in oklab, var(--color-foreground) 2%, transparent)",
    themeFallback: "rgba(255, 255, 255, 0.03)",
    provenance: "[SHIPPED]",
  },
  "--color-surface-under": {
    dark: "#141414",
    light: "#f9f9f9",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-black": {
    dark: "rgba(255, 255, 255, 0.5)",
    light: "rgba(13, 13, 13, 0.5)",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-blue": {
    dark: "#339cff",
    light: "#001bcb",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-black": {
    dark: "rgba(255, 255, 255, 0.71)",
    light: "#000000",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-blue": {
    dark: "#339cff",
    light: "#006aff",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-cyan": {
    dark: "#339cff",
    light: "#20b8ff",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-green": {
    dark: "#40c977",
    light: "#59d24e",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-magenta": {
    dark: "#ad7bf9",
    light: "#9840ff",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-red": {
    dark: "#ff6764",
    light: "#f44a4c",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-white": {
    dark: "#ffffff",
    light: "#828282",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-bright-yellow": {
    dark: "#ffd240",
    light: "#f87915",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-cyan": {
    dark: "#339cff",
    light: "#0071ea",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-green": {
    dark: "#40c977",
    light: "#008809",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-magenta": {
    dark: "#ad7bf9",
    light: "#751ed9",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-red": {
    dark: "#ff6764",
    light: "#d53538",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-white": {
    dark: "#ffffff",
    light: "#666666",
    provenance: "[SHIPPED]",
  },
  "--color-terminal-yellow": {
    dark: "#ffd240",
    light: "#bd5800",
    provenance: "[SHIPPED]",
  },
  "--color-text-caret": {
    dark: "var(--color-foreground)",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-text-selection": {
    dark: "var(--color-highlight, var(--color-input))",
    light: "var(--color-highlight, var(--color-input))",
    provenance: "[SHIPPED]",
  },
  "--color-warning": {
    dark: "rgba(255, 180, 50, 0.15)",
    light: "#fff8e6",
    provenance: "[SHIPPED]",
  },
  "--color-warning-border": {
    dark: "rgba(255, 180, 50, 0.25)",
    light: "var(--color-border)",
    provenance: "[SHIPPED]",
  },
  "--color-warning-foreground": {
    dark: "#ffb432",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--color-warning-subtle": {
    dark: "rgba(242,201,76,0.14)",
    light: "rgba(242,201,76,0.14)",
    provenance: "[SHIPPED]",
  },
  "--color-window-control-close": {
    dark: "#ff5f57",
    light: "#ff5f57",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  "--color-window-control-minimize": {
    dark: "#febc2e",
    light: "#febc2e",
    provenance: "[SHIPPED:raw-hex-move]",
  },
  /**
   * Transcript measure. Readable Markdown prose is capped at
   * `--thread-content-max-width: 40rem`, and wide blocks (tables, images,
   * code) are allowed to spill to `--markdown-wide-block-max-width: 64rem`.
   * Named in Tailwind's `--container-*` namespace so consumers write
   * `max-w-transcript-readable` / `max-w-transcript-wide` instead of an
   * arbitrary bracket width — a consistency choice, not something the
   * appearance gate forces (the gate has no max-w rule).
   */
  "--container-transcript-readable": {
    dark: "40rem",
    light: "40rem",
    provenance: "[RETUNE:layout/transcript-measure]",
  },
  /**
   * Two-tier measure: the thread column itself (avatars, action rows, wide
   * blocks) widens to 48rem while readable prose stays capped at
   * `--container-transcript-readable` (40rem, applied directly on the
   * Markdown body). See ChatColumn.ts and MarkdownBody.tsx.
   */
  "--container-transcript-thread": {
    dark: "48rem",
    light: "48rem",
    provenance: "[RETUNE:layout/transcript-measure]",
  },
  "--container-transcript-wide": {
    dark: "56rem",
    light: "56rem",
    provenance: "[RETUNE:layout/transcript-measure]",
  },
  "--diffs-addition-color-override": {
    dark: "var(--color-diff-added)",
    light: "var(--color-diff-added)",
    provenance: "[SHIPPED]",
  },
  "--diffs-bg-addition-hover-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 82%, var(--color-diff-added))",
    light: "color-mix(in srgb, var(--diff-view-surface) 78%, var(--diffs-addition-color-override))",
    themeFallback: "#14311f",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--diffs-bg-addition-number-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 91%, var(--color-diff-added))",
    light: "color-mix(in srgb, var(--color-diff-main-surface) 91%, var(--color-diff-added))",
    themeFallback: "#16241c",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--diffs-bg-addition-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 88%, var(--color-diff-added))",
    light: "color-mix(in srgb, var(--diff-view-surface) 84%, var(--diffs-addition-color-override))",
    themeFallback: "#15291d",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--diffs-bg-context-override": {
    dark: "var(--diff-view-context-surface)",
    light: "var(--diff-view-context-surface)",
    provenance: "[SHIPPED]",
  },
  "--diffs-bg-deletion-hover-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 82%, var(--color-diff-deleted))",
    light: "color-mix(in srgb, var(--diff-view-surface) 78%, var(--diffs-deletion-color-override))",
    themeFallback: "#3c1c1b",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--diffs-bg-deletion-number-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 91%, var(--color-diff-deleted))",
    light: "color-mix(in srgb, var(--color-diff-main-surface) 91%, var(--color-diff-deleted))",
    themeFallback: "#2a1a1a",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--diffs-bg-deletion-override": {
    dark: "color-mix(in srgb, var(--color-diff-main-surface) 88%, var(--color-diff-deleted))",
    light: "color-mix(in srgb, var(--diff-view-surface) 84%, var(--diffs-deletion-color-override))",
    themeFallback: "#301b1a",
    provenance: "[RETUNE:diffs/addition-deletion-color-alias]",
  },
  "--diffs-bg-separator-override": {
    dark: "var(--diff-view-separator-surface)",
    light: "var(--diff-view-separator-surface)",
    provenance: "[SHIPPED]",
  },
  "--diffs-deletion-color-override": {
    dark: "var(--color-diff-deleted)",
    light: "var(--color-diff-deleted)",
    provenance: "[SHIPPED]",
  },
  "--diffs-fg": {
    dark: "#fcfcfc",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--diffs-font-family": {
    dark: "var(--font-mono)",
    light: "var(--font-mono)",
    provenance: "[SHIPPED]",
  },
  "--diffs-font-size": {
    dark: "13px",
    light: "13px",
    provenance: "[SHIPPED]",
  },
  "--diffs-line-height": {
    dark: "calc(var(--diffs-font-size, 13px) * 1.8)",
    light: "calc(var(--diffs-font-size, 13px) * 1.8)",
    provenance: "[SHIPPED]",
  },
  "--diffs-min-number-column-width": {
    dark: "4ch",
    light: "4ch",
    provenance: "[SHIPPED]",
  },
  "--diffs-mixer": {
    dark: "#fcfcfc",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--duration-disclosure": {
    dark: motion.cssMs(motion.duration.disclosureMs),
    light: motion.cssMs(motion.duration.disclosureMs),
    provenance: "[RETUNE:motion/roles]",
  },
  "--duration-emphasized": {
    dark: motion.cssMs(motion.duration.emphasizedMs),
    light: motion.cssMs(motion.duration.emphasizedMs),
    provenance: "[RETUNE:motion/roles]",
  },
  "--duration-enter": {
    dark: motion.cssMs(motion.duration.enterMs),
    light: motion.cssMs(motion.duration.enterMs),
    provenance: "[RETUNE:motion/roles]",
  },
  "--duration-exit": {
    dark: motion.cssMs(motion.duration.exitMs),
    light: motion.cssMs(motion.duration.exitMs),
    provenance: "[RETUNE:motion/roles]",
  },
  "--duration-hover": {
    dark: motion.cssMs(motion.duration.hoverMs),
    light: motion.cssMs(motion.duration.hoverMs),
    provenance: "[RETUNE:motion/roles]",
  },
  "--duration-panel": {
    dark: motion.cssMs(motion.duration.panelMs),
    light: motion.cssMs(motion.duration.panelMs),
    provenance: "[RETUNE:motion/roles]",
  },
  "--ease-linear": {
    dark: motion.ease.linear,
    light: motion.ease.linear,
    provenance: "[RETUNE:motion/roles]",
  },
  "--ease-out-quint": {
    dark: motion.ease.outQuint,
    light: motion.ease.outQuint,
    provenance: "[RETUNE:motion/roles]",
  },
  "--ease-spring": {
    dark: motion.ease.spring,
    light: motion.ease.spring,
    provenance: "[RETUNE:motion/roles]",
  },
  "--ease-standard": {
    dark: motion.ease.standard,
    light: motion.ease.standard,
    provenance: "[RETUNE:motion/roles]",
  },
  "--font-mono": {
    dark: "\"Geist Mono\", ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
    light: "\"Geist Mono\", ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
    provenance: "[SHIPPED]",
  },
  "--font-sans": {
    dark: "-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, \"Segoe UI\", sans-serif",
    light: "-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, \"Segoe UI\", sans-serif",
    provenance: "[RETUNE:type/Geist] — trial: native system stack; Geist variant preserved in git history, swap back = revert this value",
  },
  /**
   * Base document weight. `product.css`'s `body` rule reads this token
   * instead of a bare literal so the value stays single-sourced here.
   */
  "--font-weight-body": {
    dark: "445",
    light: "445",
    provenance: "[RETUNE:type/body-weight]",
  },
  "--font-weight-control": {
    dark: "450",
    light: "450",
    provenance: "[RETUNE:type/control-weight]",
  },
  "--icon-compact": {
    dark: "1em",
    light: "1em",
    provenance: "[SHIPPED]",
  },
  "--icon-control": {
    dark: "1.333333em",
    light: "1.333333em",
    provenance: "[SHIPPED]",
  },
  "--icon-display": {
    dark: "2em",
    light: "2em",
    provenance: "[SHIPPED]",
  },
  /**
   * [RETUNE:icons/sidebar-indicator] — the sidebar row's trailing activity
   * glyphs (waiting clock, running spinner, error/warning badge) render at
   * 14px inside a 20px centered cell in the reference, against the same 12px
   * row text. 1.166667em is exactly 14px at that base — between
   * `--icon-compact` (12px, too small) and `--icon-control` (16px, visibly
   * too big), neither of which matches on screen.
   */
  "--icon-indicator": {
    dark: "1.166667em",
    light: "1.166667em",
    provenance: "[RETUNE:icons/sidebar-indicator]",
  },
  "--icon-large": {
    dark: "1.666667em",
    light: "1.666667em",
    provenance: "[SHIPPED]",
  },
  "--icon-paired": {
    dark: "1.230769em",
    light: "1.230769em",
    provenance: "[RETUNE:icons/16px-paired]",
  },
  "--icon-status": {
    dark: "0.55em",
    light: "0.55em",
    provenance: "[SHIPPED]",
  },
  /**
   * [RETUNE:icons/sidebar-trailing-tight] — round-4 sidebar feedback: the
   * trailing plus/three-dots row controls (`SidebarActionButton`, the
   * sidebar's `RowActionIconButton` kebab) rendered their glyph at
   * `--icon-control` (16px), which read 50-60% too big against the
   * reference sidebar on screen even though the ratio math looked correct.
   * `0.875em` lands at 10.5px against the sidebar row's 12px text — the
   * smallest inline-glyph tier, reserved for these row-trailing controls
   * whose 24px hit box is unusually large relative to their glyph.
   */
  "--icon-tight": {
    dark: "0.875em",
    light: "0.875em",
    provenance: "[RETUNE:icons/sidebar-trailing-tight]",
  },
  "--radius": {
    dark: "0.5rem",
    light: "0.5rem",
    provenance: "[SHIPPED]",
  },
  "--radius-2xl": {
    dark: "1rem",
    light: "1rem",
    provenance: "[RETUNE:radii/soft-scale]",
  },
  "--radius-composer": {
    dark: "1.25rem",
    light: "1.25rem",
    provenance: "[RETUNE:radii/soft-scale]",
  },
  "--radius-full": {
    dark: "9999px",
    light: "9999px",
    provenance: "[SHIPPED]",
  },
  "--radius-lg": {
    dark: "0.625rem",
    light: "0.625rem",
    provenance: "[RETUNE:radii/soft-scale]",
  },
  "--radius-md": {
    dark: "0.5rem",
    light: "0.5rem",
    provenance: "[RETUNE:radii/soft-scale]",
  },
  "--radius-sm": {
    dark: "0.375rem",
    light: "0.375rem",
    provenance: "[RETUNE:radii/soft-scale]",
  },
  "--radius-xl": {
    dark: "0.75rem",
    light: "0.75rem",
    provenance: "[SHIPPED]",
  },
  "--readable-code-font-size": {
    dark: "13px",
    light: "13px",
    provenance: "[SHIPPED]",
  },
  "--readable-code-line-height": {
    dark: "1.625",
    light: "1.625",
    provenance: "[SHIPPED]",
  },
  "--scratch-code-font-family": {
    dark: "var(--font-mono)",
    light: "var(--font-mono)",
    provenance: "[SHIPPED]",
  },
  "--scratch-font-family": {
    dark: "var(--font-sans)",
    light: "var(--font-sans)",
    provenance: "[SHIPPED]",
  },
  "--scratch-font-size": {
    dark: "var(--text-message, var(--text-composer, 13px))",
    light: "var(--text-message, var(--text-composer, 13px))",
    provenance: "[SHIPPED]",
  },
  "--scratch-line-height": {
    dark: "var(--text-message--line-height, var(--text-composer--line-height, 21px))",
    light: "var(--text-message--line-height, var(--text-composer--line-height, 21px))",
    provenance: "[SHIPPED]",
  },
  "--scratch-list-marker-leading-space": {
    dark: "0.48em",
    light: "0.48em",
    provenance: "[SHIPPED]",
  },
  "--scratch-task-box-size": {
    dark: "0.82em",
    light: "0.82em",
    provenance: "[SHIPPED]",
  },
  "--shadow-modal": {
    dark: "0 25px 50px -12px rgb(0 0 0 / 0.5)",
    light: "0 25px 50px -12px rgb(0 0 0 / 0.5)",
    provenance: "[RETUNE:elevation/near-flat]",
  },
  "--shadow-popover": {
    dark: "0 4px 12px rgb(0 0 0 / 0.12)",
    light: "0 4px 12px rgb(0 0 0 / 0.12)",
    provenance: "[RETUNE:elevation/near-flat]",
  },
  "--shadow-subtle": {
    dark: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    light: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    provenance: "[SHIPPED]",
  },
  "--size-icon-button-lg": {
    dark: "1.75rem",
    light: "1.75rem",
    provenance: "[RETUNE:icons/control-boxes]",
  },
  "--size-icon-button-md": {
    dark: "1.5rem",
    light: "1.5rem",
    provenance: "[RETUNE:icons/control-boxes]",
  },
  "--size-icon-button-sm": {
    dark: "1.25rem",
    light: "1.25rem",
    provenance: "[RETUNE:icons/control-boxes]",
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
    dark: "1rem",
    light: "1rem",
    provenance: "[RETUNE:layout/transcript-measure]",
  },
  /**
   * Tight intra-turn grouping (e.g. a prose block and its immediately
   * following action row) — deliberately smaller than
   * `--spacing-transcript-turn` so turn-to-turn rhythm and within-turn
   * rhythm read as two distinct rungs, not one shared gap.
   */
  "--spacing-transcript-turn-tight": {
    dark: "0.25rem",
    light: "0.25rem",
    provenance: "[RETUNE:layout/transcript-measure]",
  },
  "--text-body": {
    dark: "13px",
    light: "13px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-body--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-body--line-height": {
    dark: "20px",
    light: "20px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-body-emphasis": {
    dark: "14px",
    light: "14px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-body-emphasis--letter-spacing": {
    dark: "-0.005em",
    light: "-0.005em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-body-emphasis--line-height": {
    dark: "21px",
    light: "21px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-chat": {
    dark: "13px",
    light: "13px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-chat--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-chat--line-height": {
    dark: "20px",
    light: "20px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-chat-meta": {
    dark: "calc(var(--text-chat, 13px) - 2px)",
    light: "calc(var(--text-chat, 13px) - 2px)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-composer": {
    dark: "13px",
    light: "13px",
    provenance: "[SHIPPED]",
  },
  "--text-composer--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-composer--line-height": {
    dark: "20px",
    light: "20px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-heading": {
    dark: "16px",
    light: "16px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-heading--letter-spacing": {
    dark: "var(--tracking-heading)",
    light: "var(--tracking-heading)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-heading--line-height": {
    dark: "23px",
    light: "23px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-hero": {
    dark: "26px",
    light: "26px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-hero--letter-spacing": {
    dark: "var(--tracking-tight)",
    light: "var(--tracking-tight)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-hero--line-height": {
    dark: "34px",
    light: "34px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-message": {
    dark: "var(--text-composer)",
    light: "var(--text-composer)",
    provenance: "[SHIPPED]",
  },
  "--text-message--letter-spacing": {
    dark: "var(--text-composer--letter-spacing)",
    light: "var(--text-composer--letter-spacing)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-message--line-height": {
    dark: "var(--text-composer--line-height)",
    light: "var(--text-composer--line-height)",
    provenance: "[SHIPPED]",
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
    provenance: "[RETUNE:type/markdown-heading-ramp]",
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
    provenance: "[RETUNE:type/markdown-heading-ramp]",
  },
  "--markdown-heading-h4-scale": {
    dark: "1.0833",
    light: "1.0833",
    provenance: "[RETUNE:type/markdown-heading-ramp]",
  },
  "--text-readable-code": {
    dark: "var(--readable-code-font-size)",
    light: "var(--readable-code-font-size)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-readable-code--letter-spacing": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-readable-code--line-height": {
    dark: "var(--readable-code-line-height)",
    light: "var(--readable-code-line-height)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-sidebar-brand": {
    dark: "16px",
    light: "16px",
    provenance: "[SHIPPED]",
  },
  "--text-sidebar-brand--letter-spacing": {
    dark: "var(--tracking-heading)",
    light: "var(--tracking-heading)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-sidebar-brand--line-height": {
    dark: "23px",
    light: "23px",
    provenance: "[SHIPPED]",
  },
  "--text-sidebar-nav": {
    dark: "12px",
    light: "12px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-sidebar-nav--letter-spacing": {
    dark: "0.005em",
    light: "0.005em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-sidebar-nav--line-height": {
    dark: "17px",
    light: "17px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-sidebar-row": {
    dark: "12px",
    light: "12px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-sidebar-row--letter-spacing": {
    dark: "0.005em",
    light: "0.005em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-sidebar-row--line-height": {
    dark: "17px",
    light: "17px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-title": {
    dark: "19px",
    light: "19px",
    provenance: "[SHIPPED]",
  },
  "--text-title--letter-spacing": {
    dark: "var(--tracking-tight)",
    light: "var(--tracking-tight)",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-title--line-height": {
    dark: "24px",
    light: "24px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-ui": {
    dark: "12px",
    light: "12px",
    provenance: "[SHIPPED]",
  },
  "--text-ui--letter-spacing": {
    dark: "0.005em",
    light: "0.005em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-ui--line-height": {
    dark: "17px",
    light: "17px",
    provenance: "[SHIPPED]",
  },
  "--text-ui-sm": {
    dark: "11px",
    light: "11px",
    provenance: "[SHIPPED]",
  },
  "--text-ui-sm--letter-spacing": {
    dark: "0.01em",
    light: "0.01em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-ui-sm--line-height": {
    dark: "15px",
    light: "15px",
    provenance: "[SHIPPED]",
  },
  "--text-workspace-title": {
    dark: "14px",
    light: "14px",
    provenance: "[SHIPPED]",
  },
  "--text-workspace-title--letter-spacing": {
    dark: "-0.005em",
    light: "-0.005em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--text-workspace-title--line-height": {
    dark: "21px",
    light: "21px",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--tracking-heading": {
    dark: "-0.01em",
    light: "-0.01em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--tracking-tight": {
    dark: "-0.025em",
    light: "-0.025em",
    provenance: "[RETUNE:type/closed-ramp]",
  },
  "--workspace-shell-action-background": {
    dark: "transparent",
    light: "transparent",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-action-border": {
    dark: "var(--color-border)",
    light: "var(--color-border)",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-action-font-size": {
    dark: "var(--text-ui-sm)",
    light: "var(--text-ui-sm)",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-action-font-weight": {
    dark: "var(--font-weight-control)",
    light: "var(--font-weight-control)",
    provenance: "[RETUNE:type/control-weight]",
  },
  "--workspace-shell-action-foreground": {
    dark: "var(--color-muted-foreground)",
    light: "var(--color-muted-foreground)",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-action-hover-foreground": {
    dark: "var(--color-foreground)",
    light: "var(--color-foreground)",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-action-line-height": {
    dark: "var(--text-ui-sm--line-height)",
    light: "var(--text-ui-sm--line-height)",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-action-radius": {
    dark: "0.5rem",
    light: "0.5rem",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-action-size": {
    dark: "1.75rem",
    light: "1.75rem",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-tab-active-border": {
    dark: "var(--color-border)",
    light: "var(--color-border)",
    provenance: "[RETUNE:header/quiet-active-tab]",
  },
  "--workspace-shell-tab-content-gap": {
    dark: "0.5rem",
    light: "0.5rem",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-tab-height": {
    dark: "1.75rem",
    light: "1.75rem",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-tab-hover-border": {
    dark: "transparent",
    light: "transparent",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-tab-inactive-background": {
    dark: "transparent",
    light: "transparent",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-tab-inactive-border": {
    dark: "transparent",
    light: "transparent",
    provenance: "[SHIPPED]",
  },
  "--workspace-shell-tab-radius": {
    dark: "0.375rem",
    light: "0.375rem",
    provenance: "[RETUNE:radii/soft-scale]",
  },
  "--workspace-shell-tab-selected-border": {
    dark: "var(--color-border-heavy)",
    light: "var(--color-border-heavy)",
    provenance: "[SHIPPED]",
  },
  "--z-base": {
    dark: "0",
    light: "0",
    provenance: "[RETUNE:layering/scale]",
  },
  "--z-overlay": {
    dark: "40",
    light: "40",
    provenance: "[RETUNE:layering/scale]",
  },
  "--z-popover": {
    dark: "50",
    light: "50",
    provenance: "[RETUNE:layering/scale]",
  },
  "--z-raised": {
    dark: "10",
    light: "10",
    provenance: "[RETUNE:layering/scale]",
  },
  "--z-sticky": {
    dark: "20",
    light: "20",
    provenance: "[RETUNE:layering/scale]",
  },
  "--z-toast": {
    dark: "60",
    light: "60",
    provenance: "[RETUNE:layering/scale]",
  },
  "--z-tooltip": {
    dark: "70",
    light: "70",
    provenance: "[RETUNE:layering/scale]",
  },
  "--z-top": {
    dark: "80",
    light: "80",
    provenance: "[RETUNE:layering/scale]",
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
