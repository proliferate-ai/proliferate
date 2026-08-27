import type { AgentSummary } from "@anyharness/sdk";

type AgentAuthStateSummary = NonNullable<AgentSummary["authState"]>;

/**
 * Seat-rotation fields on the runtime's `authState` summary (agent_auth spec
 * §4 "Rotation ownership": the status document exposes the serving seat and
 * the next in line; `coolingUntil` is non-null ONLY when no seat can serve
 * right now — all cooling, or a rotate-off pinned seat cooling).
 *
 * THE ONE LOCAL TYPE EXTENSION for this contract: the runtime lane ships
 * `servingSeatId` / `nextSeatId` / `coolingUntil` on `AgentAuthStateSummary`
 * in the same slice, so the generated anyharness SDK type does not carry them
 * yet. `readAuthRotation` narrows structurally by value; delete this module's
 * rider cast once the SDK regen carries the fields.
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
  const rider = (authState ?? null) as {
    servingSeatId?: unknown;
    nextSeatId?: unknown;
    coolingUntil?: unknown;
  } | null;
  return {
    servingSeatId: typeof rider?.servingSeatId === "string" ? rider.servingSeatId : null,
    nextSeatId: typeof rider?.nextSeatId === "string" ? rider.nextSeatId : null,
    coolingUntil: typeof rider?.coolingUntil === "string" ? rider.coolingUntil : null,
  };
}
