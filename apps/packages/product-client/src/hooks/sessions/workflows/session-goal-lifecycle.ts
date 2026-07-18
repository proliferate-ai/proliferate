import type { Goal, GoalArmState, SetSessionGoalRequest } from "@anyharness/sdk";
import { DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET } from "#product/config/goals";

type GoalSnapshot = Pick<
  Goal,
  "createdAt" | "objective" | "revision" | "status" | "updatedAt"
>;

interface SessionGoalIntent {
  createdAt: string | null;
  objective: string | null;
  revision: number | null;
  status: Goal["status"];
  updatedAt: string | null;
  updatedAtMs: number | null;
}

export interface SessionCancelGoalFence {
  action: "none" | "pause" | "clear";
  /** A false clear cannot fence a newer UI mutation that the mirror has not observed. */
  requirePresentGoalForClear: boolean;
}

// Renderer-scoped workflow coordination. Goal intent is short-lived metadata
// that bridges a confirmed mutation response to its later streamed mirror
// event; the session mirror remains authoritative product state.
const sessionLifecycleTails = new Map<string, Promise<void>>();
const sessionGoalIntents = new Map<string, SessionGoalIntent>();

/**
 * Preserve per-client-session intent order across pending-to-materialized ID
 * transitions. Enqueue callers before their first await so later goal writes,
 * Pause/Resume, and Cancel cannot overtake.
 */
export function enqueueSessionGoalLifecycleMutation<T>(
  clientSessionId: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = sessionLifecycleTails.get(clientSessionId) ?? Promise.resolve();
  const result = previous.then(mutation, mutation);
  const tail = result.then(() => undefined, () => undefined);
  sessionLifecycleTails.set(clientSessionId, tail);
  void tail.finally(() => {
    if (sessionLifecycleTails.get(clientSessionId) === tail) {
      sessionLifecycleTails.delete(clientSessionId);
    }
  });
  return result;
}

export function recordSessionGoalMutation(
  materializedSessionId: string,
  goal: GoalSnapshot,
): void {
  sessionGoalIntents.set(materializedSessionId, {
    createdAt: goal.createdAt,
    objective: goal.objective,
    revision: goal.revision,
    status: goal.status,
    updatedAt: goal.updatedAt,
    updatedAtMs: parsedTime(goal.updatedAt),
  });
}

export function recordSessionGoalCleared(
  materializedSessionId: string,
  previousMirrorGoal: GoalSnapshot | null,
): void {
  const previousIntent = sessionGoalIntents.get(materializedSessionId);
  sessionGoalIntents.set(materializedSessionId, {
    createdAt: previousMirrorGoal?.createdAt ?? previousIntent?.createdAt ?? null,
    objective: previousMirrorGoal?.objective ?? previousIntent?.objective ?? null,
    revision: previousMirrorGoal?.revision ?? previousIntent?.revision ?? null,
    status: "cleared",
    updatedAt: previousMirrorGoal?.updatedAt ?? previousIntent?.updatedAt ?? null,
    updatedAtMs: previousMirrorGoal
      ? parsedTime(previousMirrorGoal.updatedAt)
      : previousIntent?.updatedAtMs ?? null,
  });
}

export function forgetSessionGoalIntent(materializedSessionId: string): void {
  sessionGoalIntents.delete(materializedSessionId);
}

export function buildGoalObjectiveRequest(
  objective: string,
  currentGoalStatus: Goal["status"] | null,
): SetSessionGoalRequest {
  if (currentGoalStatus === "active" || currentGoalStatus === "paused") {
    // An in-place edit must not silently replace accounting the native goal
    // engine already owns.
    return { objective };
  }
  return {
    objective,
    tokenBudget: DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET,
  };
}

/** Build at queue execution time, after earlier Clear/Pause/Resume has landed. */
export function buildQueuedGoalObjectiveRequest(
  materializedSessionId: string,
  objective: string,
  mirrorGoal: GoalSnapshot | null,
): SetSessionGoalRequest {
  // A local clear makes the next local objective a new goal lifetime even if
  // an older active event (or a deferred-set insert with a new createdAt) is
  // still catching up in the mirror.
  if (sessionGoalIntents.get(materializedSessionId)?.status === "cleared") {
    return buildGoalObjectiveRequest(objective, "cleared");
  }
  return buildGoalObjectiveRequest(
    objective,
    resolveSessionGoalState(materializedSessionId, mirrorGoal).status,
  );
}

export function sessionCancelGoalFence(input: {
  materializedSessionId: string;
  mirrorGoal: GoalSnapshot | null;
  pauseSupported: boolean;
}): SessionCancelGoalFence {
  const state = resolveSessionGoalState(input.materializedSessionId, input.mirrorGoal);
  if (state.status !== "active" && state.status !== "blocked") {
    return { action: "none", requirePresentGoalForClear: false };
  }
  if (input.pauseSupported) {
    return { action: "pause", requirePresentGoalForClear: false };
  }
  return {
    action: "clear",
    requirePresentGoalForClear: state.source === "intent",
  };
}

export class SessionGoalStopError extends Error {
  readonly causeValue: unknown;

  constructor(causeValue: unknown) {
    const detail = causeValue instanceof Error ? `: ${causeValue.message}` : "";
    super(`The goal stop could not be confirmed${detail}`);
    this.name = "SessionGoalStopError";
    this.causeValue = causeValue;
  }
}

export function requireSafeGoalClear(
  response: { cleared: boolean },
  fence: Pick<SessionCancelGoalFence, "requirePresentGoalForClear">,
): void {
  if (fence.requirePresentGoalForClear && !response.cleared) {
    throw new Error("the native harness has not observed the newer goal mutation");
  }
}

export function requireGoalArmState(
  goal: Pick<Goal, "status">,
  expected: GoalArmState,
): void {
  if (goal.status !== expected) {
    throw new Error(`the native harness confirmed ${goal.status}, not ${expected}`);
  }
}

/**
 * Persist the goal's stop fence before interrupting the current turn. Native
 * goal continuation runs after a turn becomes idle, so cancelling first can
 * immediately re-arm another iteration.
 */
export async function stopGoalThenCancelCurrentWork(input: {
  stopGoal: () => Promise<unknown>;
  cancelCurrentWork: () => Promise<unknown>;
}): Promise<void> {
  try {
    await input.stopGoal();
  } catch (error) {
    throw new SessionGoalStopError(error);
  }
  await input.cancelCurrentWork();
}

function resolveSessionGoalState(
  materializedSessionId: string,
  mirrorGoal: GoalSnapshot | null,
): { status: Goal["status"] | null; source: "intent" | "mirror" | "none" } {
  const intent = sessionGoalIntents.get(materializedSessionId);
  if (!intent) {
    return mirrorGoal
      ? { status: mirrorGoal.status, source: "mirror" }
      : { status: null, source: "none" };
  }

  if (intent.status === "cleared") {
    if (!mirrorGoal) {
      sessionGoalIntents.delete(materializedSessionId);
      return { status: null, source: "none" };
    }
    if (mirrorMatchesClearedPredecessor(intent, mirrorGoal)) {
      return { status: "cleared", source: "intent" };
    }
    sessionGoalIntents.delete(materializedSessionId);
    return { status: mirrorGoal.status, source: "mirror" };
  }

  if (mirrorGoal && mirrorHasCaughtUp(intent, mirrorGoal)) {
    sessionGoalIntents.delete(materializedSessionId);
    return { status: mirrorGoal.status, source: "mirror" };
  }
  return { status: intent.status, source: "intent" };
}

function mirrorMatchesClearedPredecessor(
  intent: SessionGoalIntent,
  mirrorGoal: GoalSnapshot,
): boolean {
  return intent.createdAt !== null
    && intent.createdAt === mirrorGoal.createdAt;
}

function mirrorHasCaughtUp(intent: SessionGoalIntent, mirrorGoal: GoalSnapshot): boolean {
  if (
    intent.createdAt === mirrorGoal.createdAt
    && intent.objective === mirrorGoal.objective
    && intent.revision === mirrorGoal.revision
    && intent.status === mirrorGoal.status
    && intent.updatedAt === mirrorGoal.updatedAt
  ) {
    return true;
  }
  const mirrorUpdatedAtMs = parsedTime(mirrorGoal.updatedAt);
  if (intent.updatedAtMs !== null && mirrorUpdatedAtMs !== null) {
    if (mirrorUpdatedAtMs !== intent.updatedAtMs) {
      return mirrorUpdatedAtMs > intent.updatedAtMs;
    }
    // JS timestamps lose RFC3339 sub-millisecond precision. On an equal
    // parsed millisecond, prefer any mirrored running state over a local
    // stopped intent; that conservative tie-break cannot permit an armed goal
    // to bypass its fence even when a new lifetime reset the revision.
    const intentMayRun = intent.status === "active" || intent.status === "blocked";
    const mirrorMayRun = mirrorGoal.status === "active" || mirrorGoal.status === "blocked";
    if (intentMayRun || mirrorMayRun) {
      return mirrorMayRun && !intentMayRun;
    }
    return intent.revision !== null && mirrorGoal.revision >= intent.revision;
  }
  return intent.objective === mirrorGoal.objective
    && intent.revision !== null
    && mirrorGoal.revision >= intent.revision;
}

function parsedTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
