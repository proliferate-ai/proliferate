import type { Goal, SessionActionCapabilities } from "@anyharness/sdk";
import type { GoalCapabilities, GoalWire } from "@proliferate/product-domain/activity/goal";

/**
 * Native pause support per harness. The GoalPort capability advertisement
 * (`InitializeResponse._meta.anyharness.goals`) does not carry a pause flag
 * in schema v1, so this table mirrors the verified native capability matrix
 * (codex pauses through its goal engine; claude has no native pause) until
 * the wire advertises it. Everything downstream gates on the projected
 * `GoalCapabilities` flags, never on a harness name.
 */
const NATIVE_GOAL_PAUSE_BY_AGENT_KIND: Readonly<Record<string, boolean>> = {
  codex: true,
};

/**
 * Whether a goal set/edit applies at a discrete turn boundary for this
 * harness (so it reads honestly as a standalone transcript row). Claude
 * defers a `/goal` edit to the turn boundary, firing a discrete
 * `goal_updated` — an honest "goal set/edited" moment. Codex steers the
 * running turn live with no discrete apply, so a set/edit row would mislead;
 * everything else defaults off. Gated on the flag downstream, never a
 * harness name.
 */
const SET_EDIT_TRANSCRIPT_ROWS_BY_AGENT_KIND: Readonly<Record<string, boolean>> = {
  claude: true,
};

export function goalCapabilitiesForSession(
  actionCapabilities: SessionActionCapabilities,
  agentKind: string,
): GoalCapabilities {
  const supported = actionCapabilities.supportsGoals ?? false;
  return {
    supported,
    native: supported,
    pause: supported && (NATIVE_GOAL_PAUSE_BY_AGENT_KIND[agentKind] ?? false),
    setEditTranscriptRows:
      supported && (SET_EDIT_TRANSCRIPT_ROWS_BY_AGENT_KIND[agentKind] ?? false),
  };
}

/**
 * Projects the runtime's mirrored goal record into the wire-contract shape
 * the goal bar renders. Pure field mapping — no state is invented; absent
 * optionals read as null exactly like the sidecar wire payloads.
 */
export function goalWireFromMirror(goal: Goal): GoalWire {
  return {
    objective: goal.objective,
    status: goal.status,
    nativeStatus: goal.nativeStatus ?? goal.status,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? null,
    timeUsedSeconds: goal.timeUsedSeconds ?? null,
    metReason: goal.metReason ?? null,
    iterations: goal.iterations ?? null,
    native: goal.native,
    updatedAtMs: Date.parse(goal.updatedAt) || 0,
  };
}
