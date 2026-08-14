/**
 * Shared authority for interaction motion and named activity cadence, giving
 * role durations and named eases a single owner.
 *
 * Duration/ease roles are projected into CSS custom properties by
 * `scripts/generate-theme.mjs`, so a component never hand-authors a millisecond
 * literal or a bezier. JS consumers that must schedule in lockstep with CSS
 * import these numbers and format them through `motion.cssMs()`.
 */

/** Single owner of the CSS millisecond suffix for shared numeric timings. */
function cssMs(value: number): `${number}ms` {
  return `${value}ms`;
}

export const motion = {
  /** Finite interaction motion. Reduced motion zeroes every entry below. */
  duration: {
    /** Pointer/focus hover, color and opacity feedback. */
    hoverMs: 120,
    /** Entrance of content, modals, popovers, toasts. */
    enterMs: 160,
    /** Exit of the same surfaces; deliberately faster than entrance. */
    exitMs: 120,
    /** Disclosure/chevron/height transforms. */
    disclosureMs: 200,
    /** Panel and rail geometry. */
    panelMs: 240,
    /** A compact item joining an already-mounted group. */
    popMs: 280,
    /** Emphasized, spring-led product moments. */
    emphasizedMs: 300,
    /** Slow ambient dissolve of transient overlays (e.g. the todo progress
     * pill's linger fade) — long enough to read as evaporation, not exit. */
    dissolveMs: 600,
  },
  ease: {
    outQuint: "cubic-bezier(0.19, 1, 0.22, 1)",
    /**
     * Moderate deceleration: leaves quickly, then eases into the end. Sits
     * between `standard` (symmetric, no initial urgency) and `outQuint` (so
     * front-loaded it covers almost all the distance immediately and then
     * visibly idles). For motion long enough to watch, where the eye should
     * read a fast departure *and* a settle rather than one or the other.
     */
    outCubic: "cubic-bezier(0.22, 0.61, 0.36, 1)",
    /** Compact arrival with a small, deliberate overshoot. */
    pop: "cubic-bezier(0.2, 0.9, 0.3, 1.3)",
    spring: "cubic-bezier(0.16, 1, 0.3, 1)",
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    linear: "linear",
  },
  /**
   * Activity feedback (loops and streaming choreography). Not aliased to the
   * interaction scale: loops keep their cadence when transitions drop to 0ms.
   */
  activity: {
    thinkingCycleMs: 1800,
    streamRevealFadeMs: 320,
    streamRevealHandoffDelayMs: 160,
    /**
     * Typewriter reveal of a tab label the first time a session is titled.
     * A cadence, not an interaction: it is per-character and must survive the
     * reduced-motion zeroing of the interaction scale as a plain instant
     * label. JS drives the character clock, so it reads this number directly.
     */
    tabNameRevealMs: 420,
  },
  /** UI choreography delays; these are not animation durations. */
  delay: {
    autoHideScrollbarMs: 700,
    hoverCardHideMs: 120,
    levelBarStaggerMs: 110,
  },
  cssMs,
} as const;

export type MotionDurationRole = keyof typeof motion.duration;
export type MotionEaseRole = keyof typeof motion.ease;
