import type { AgentSummary } from "@anyharness/sdk";

type AgentAuthStateSummary = NonNullable<AgentSummary["authState"]>;

/**
 * Seat-rotation fields on the runtime's `authState` summary (agent_auth spec
 * §4 "Rotation ownership": the status document exposes the serving seat and
 * the next in line; `coolingUntil` is non-null ONLY when no seat can serve
 * right now — all cooling, or a rotate-off pinned seat cooling).
 *
 * The generated SDK type (`AgentAuthStateSummary`) carries all three fields;
 * this summary merely normalizes their optionality (`?: string | null`) to
 * plain nulls so consumers branch on one shape.
 */
export interface AgentAuthRotationSummary {
  /** The seat serving now, or null when the summary carries none. */
  servingSeatId: string | null;
  /**
   * What the next launch would pick — may equal serving; absent (null) when
   * the pool holds fewer than two seats.
   */
  nextSeatId: string | null;
  /** RFC3339 instant the earliest cooling seat resets; null when serveable. */
  coolingUntil: string | null;
}

export function readAuthRotation(
  authState: AgentAuthStateSummary | null | undefined,
): AgentAuthRotationSummary {
  return {
    servingSeatId: authState?.servingSeatId ?? null,
    nextSeatId: authState?.nextSeatId ?? null,
    coolingUntil: authState?.coolingUntil ?? null,
  };
}
