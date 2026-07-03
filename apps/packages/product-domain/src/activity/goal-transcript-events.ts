/**
 * Goal lifecycle transcript rows — client-side composition only.
 *
 * The runtime deliberately keeps goal_updated/goal_met/goal_cleared chunks
 * out of stored transcript content (see `codex/session-activity-architecture
 * .md` §Locked decisions #5): they're session-level mirror events, not
 * transcript items. This module derives the quiet, compact system-style rows
 * the transcript interleaves *client-side* from the raw session event
 * stream — the same envelopes the goal bar's mirror reads, replayed here to
 * recover the lifecycle history (set → edited → paused/resumed → met/
 * cleared) instead of just the latest value.
 */

import type { Goal, GoalStatus, SessionEventEnvelope } from "@anyharness/sdk";

export type GoalTranscriptEventKind =
  | "set"
  | "edited"
  | "paused"
  | "resumed"
  | "blocked"
  | "met"
  | "failed"
  | "cleared";

export interface GoalTranscriptEvent {
  /** Stable row key — derived from the originating envelope's seq. */
  id: string;
  seq: number;
  /** The turn active when this event landed; null if none had started yet. */
  turnId: string | null;
  kind: GoalTranscriptEventKind;
  objective: string;
  /** Claude evaluator reason (met) / verbatim native detail, when present. */
  detail: string | null;
}

const GOAL_EVENT_TYPES = new Set(["goal_updated", "goal_met", "goal_cleared"]);

/**
 * Replays a session's full raw envelope history into an ordered, deduped
 * list of goal lifecycle rows. Pure and side-effect free — callers memoize
 * on the envelope array identity.
 *
 * Dedupe rule: codex emits accounting-only goal_updated ticks mid-drive
 * (tokensUsed/timeUsedSeconds moving, objective and status unchanged) — those
 * must not each produce a row. A row is emitted only when the objective
 * text changes, the status changes, or a terminal event (met/cleared)
 * fires.
 */
export function deriveGoalTranscriptEvents(
  envelopes: readonly SessionEventEnvelope[],
): readonly GoalTranscriptEvent[] {
  const sorted = [...envelopes].sort((left, right) => left.seq - right.seq);
  const results: GoalTranscriptEvent[] = [];

  let priorObjective: string | null = null;
  let priorStatus: GoalStatus | null = null;

  for (const envelope of sorted) {
    const event = envelope.event;
    if (!GOAL_EVENT_TYPES.has(event.type)) {
      continue;
    }
    // Narrowed by the membership check above; the union only has these
    // three variants shaped { type; goal: Goal }.
    const goal = (event as { goal: Goal }).goal;
    const turnId = envelope.turnId ?? null;

    if (event.type === "goal_cleared") {
      results.push({
        id: goalTranscriptEventId(envelope.seq),
        seq: envelope.seq,
        turnId,
        kind: "cleared",
        objective: goal.objective,
        detail: null,
      });
      priorObjective = null;
      priorStatus = null;
      continue;
    }

    if (event.type === "goal_met") {
      results.push({
        id: goalTranscriptEventId(envelope.seq),
        seq: envelope.seq,
        turnId,
        kind: "met",
        objective: goal.objective,
        detail: goal.metReason ?? null,
      });
      priorObjective = goal.objective;
      priorStatus = goal.status;
      continue;
    }

    // goal_updated
    const isFirstSighting = priorObjective === null;
    const kind = resolveGoalUpdatedKind({
      goal,
      isFirstSighting,
      priorObjective,
      priorStatus,
    });
    if (kind) {
      results.push({
        id: goalTranscriptEventId(envelope.seq),
        seq: envelope.seq,
        turnId,
        kind,
        objective: goal.objective,
        detail: goalStatusChangeDetail(kind, goal),
      });
    }
    priorObjective = goal.objective;
    priorStatus = goal.status;
  }

  return results;
}

function resolveGoalUpdatedKind({
  goal,
  isFirstSighting,
  priorObjective,
  priorStatus,
}: {
  goal: Goal;
  isFirstSighting: boolean;
  priorObjective: string | null;
  priorStatus: GoalStatus | null;
}): GoalTranscriptEventKind | null {
  // The very first sighting of a goal always renders as "set" — including
  // when joining mid-lifecycle (paginated history that skips the original
  // set), where `revision` may already be > 1. Every later goal_updated
  // must be classified purely by what actually changed (objective/status)
  // — gating this on `goal.revision <= 1` as well would misfire on codex's
  // accounting-only ticks, which don't bump revision and can repeat for a
  // while after the real set (see the dedupe rule above).
  if (isFirstSighting) {
    return "set";
  }
  if (goal.objective !== priorObjective) {
    return "edited";
  }
  if (goal.status !== priorStatus) {
    return goalStatusChangeKind(goal.status);
  }
  // Accounting-only tick (tokensUsed/timeUsedSeconds moved, nothing else) —
  // no row.
  return null;
}

function goalStatusChangeKind(status: GoalStatus): GoalTranscriptEventKind | null {
  switch (status) {
    case "paused":
      return "paused";
    case "active":
      return "resumed";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    // "met" / "cleared" arrive through their own dedicated events, never as
    // a goal_updated status transition.
    case "met":
    case "cleared":
      return null;
  }
}

function goalStatusChangeDetail(kind: GoalTranscriptEventKind, goal: Goal): string | null {
  if (kind === "blocked" || kind === "failed") {
    return goal.nativeStatus ?? goal.metReason ?? null;
  }
  return null;
}

// Bare seq: already globally unique within a session's event stream. Row
// keys namespace this themselves (`goal-event:${id}`, see
// `buildGoalEventRowKey` in transcript-row-model.ts) — this id must stay
// prefix-free so that namespacing isn't doubled.
function goalTranscriptEventId(seq: number): string {
  return String(seq);
}
