import type {
  ActivityProcess,
  ActivitySubagent,
  Loop,
  SessionActivity,
  SessionEvent,
} from "@anyharness/sdk";

/**
 * Folds a roster/loop stream event into the mirrored `SessionActivity`
 * aggregate. The runtime emits these only after native state round-trips (loops
 * are strict mirrors where native, product-scheduled where emulated; rosters
 * are read-only) — so the fold is authoritative, never optimistic. Returns:
 * - `undefined` when the event is not an activity event (leave the slot as-is),
 * - the next `SessionActivity` (possibly `null` when the aggregate is empty)
 *   otherwise.
 *
 * `turn` and `goal` are carried through untouched — the goal mirror is owned by
 * the `activeGoal` slot, and `turn` is sourced from the activity snapshot.
 */
export function foldActivityEvent(
  current: SessionActivity | null,
  event: SessionEvent,
): SessionActivity | null | undefined {
  switch (event.type) {
    case "loop_upserted":
    case "loop_fired":
      return normalize(withLoops(current, upsertById(loopsOf(current), event.loop, "loopId")));
    case "loop_removed":
      return normalize(
        withLoops(current, loopsOf(current).filter((l) => l.loopId !== event.loopId)),
      );
    case "process_upserted":
      return normalize(
        withProcesses(current, upsertById(processesOf(current), event.process, "id")),
      );
    case "subagent_upserted":
      return normalize(withAgents(current, upsertById(agentsOf(current), event.agent, "id")));
    default:
      return undefined;
  }
}

function loopsOf(activity: SessionActivity | null): Loop[] {
  return activity?.loops ?? [];
}
function processesOf(activity: SessionActivity | null): ActivityProcess[] {
  return activity?.processes ?? [];
}
function agentsOf(activity: SessionActivity | null): ActivitySubagent[] {
  return activity?.agents ?? [];
}

function base(activity: SessionActivity | null): SessionActivity {
  return activity ?? { turn: { status: "idle" } };
}

function withLoops(activity: SessionActivity | null, loops: Loop[]): SessionActivity {
  return { ...base(activity), loops };
}
function withProcesses(
  activity: SessionActivity | null,
  processes: ActivityProcess[],
): SessionActivity {
  return { ...base(activity), processes };
}
function withAgents(
  activity: SessionActivity | null,
  agents: ActivitySubagent[],
): SessionActivity {
  return { ...base(activity), agents };
}

function upsertById<T>(items: readonly T[], next: T, key: keyof T): T[] {
  const index = items.findIndex((item) => item[key] === next[key]);
  if (index === -1) {
    return [...items, next];
  }
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

/**
 * Collapse an all-empty aggregate back to `null` so "no activity" has one
 * canonical representation (keeps the directory-entry equality check stable and
 * matches the seed default).
 */
function normalize(activity: SessionActivity | null): SessionActivity | null {
  if (!activity) {
    return null;
  }
  const isIdle = activity.turn.status === "idle";
  const empty =
    !activity.goal
    && (activity.loops?.length ?? 0) === 0
    && (activity.processes?.length ?? 0) === 0
    && (activity.agents?.length ?? 0) === 0;
  return isIdle && empty ? null : activity;
}
