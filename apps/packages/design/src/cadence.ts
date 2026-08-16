/**
 * Shared authority for data-refresh polling cadence: how often a client
 * re-asks a server for something that changes on its own schedule, not how a
 * pixel moves.
 *
 * Deliberately a sibling of `motion.ts`, not a section inside it. Motion's own
 * doc comment guarantees every entry there "zeroes" under reduced motion —
 * that guarantee would be false for a polling interval, which must keep
 * ticking regardless of the user's motion preference. Polling cadence also
 * doesn't feed `scripts/generate-theme.mjs` or CSS custom properties the way
 * duration/ease roles do; it has no visual/theme surface at all. Folding it
 * into `motion` would blur a real semantic boundary for no shared benefit, so
 * it gets its own home instead (UX Latency + Transitions ADR §4.7, Rung 6,
 * Q8).
 *
 * Every raw poll/refetch interval in the product should resolve to one of
 * these four named cadences. A value that doesn't sit on the scale should
 * snap to the nearest token when the difference is inconsequential and never
 * tightens (more frequent) the existing poll; where snapping would either
 * tighten the poll or distort it by an inconsequential-breaking amount, the
 * call site should declare its own named exception constant with a comment
 * recording why, rather than force-fitting one of these four numbers.
 */
export const cadence = {
  /** Tight follow-up loop for a state the user is actively watching resolve
   * (e.g. a parked cloud-workspace launch mid-provision). */
  fastMs: 1_000,
  /** Default cadence for background state that should feel current without
   * being chatty. */
  standardMs: 5_000,
  /** Cadence for state that is cheap to leave stale a while: auth/session
   * probes, file-tree change indicators. */
  relaxedMs: 15_000,
  /** Cadence for state that rarely changes within a session. */
  slowMs: 60_000,
} as const;

export type CadenceRole = keyof typeof cadence;
