function cssMs(value: number): `${number}ms` {
  return `${value}ms`;
}

/** Shared authority for finite interaction motion and named activity cadence. */
export const motion = {
  duration: {
    hoverMs: 120,
    enterMs: 160,
    exitMs: 120,
    disclosureMs: 200,
    panelMs: 240,
    emphasizedMs: 300,
  },
  ease: {
    outQuint: "cubic-bezier(0.19, 1, 0.22, 1)",
    spring: "cubic-bezier(0.16, 1, 0.3, 1)",
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    linear: "linear",
  },
  activity: {
    thinkingCycleMs: 1800,
    streamRevealFadeMs: 320,
    streamRevealHandoffDelayMs: 160,
    updateReadySweepMs: 700,
  },
  delay: {
    autoHideScrollbarMs: 700,
    hoverCardHideMs: 120,
    levelBarStaggerMs: 110,
  },
  cssMs,
} as const;
