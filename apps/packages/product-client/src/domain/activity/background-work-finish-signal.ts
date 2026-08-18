/**
 * Finish-signal ladder (rungs 1-3): the pane's tab dot and its in-pane
 * `NoticeBanner` both need to know "what was the most recent piece of
 * background work to finish, and is it newer than the last time this was
 * viewed" (Design Handoff — HANDOFF-background-work.md, "Finish signals are
 * a ladder"; Delivery Spec — Background Work Slice 1, rung R5).
 *
 * Processes never leave the roster (session-activity-architecture), so their
 * `endedAt` is read straight off the live roster — a REAL, server-stamped
 * time. Native subagents DO leave the roster the instant they finish, so the
 * only record of a subagent's finish is whatever
 * `useBackgroundWorkFinishSignalTracking` observed at the moment it
 * disappeared; that observation is cached by session in the workspace UI
 * store and read back in here as `cachedFinishedSubagent`.
 *
 * That cached observation's `detectedAtMs` is deliberately NOT treated as
 * the subagent's real finish time (R5 review round 2 — MAJOR): it is only
 * the moment this client happened to notice the disappearance, which can
 * lag arbitrarily behind the true finish whenever the tracker wasn't
 * actively watching that session (see `useSessionActivityForSession`'s
 * docstring on cold sessions). Ranking a real, known `endedAt` against an
 * unknown detection time is handled by an explicit, deterministic tiebreak
 * below rather than a raw `atMs` comparison, which would let a late
 * detection falsely "outrank" — and get named in the banner over — a
 * process that really did finish more recently.
 */

import type { ActivityProcessWire } from "./process";
import { isProcessRunning } from "./process";
import type { ActivitySubagentWire } from "./subagent";

export type BackgroundWorkFinishSignal =
  | { kind: "process"; process: ActivityProcessWire; atMs: number }
  | { kind: "subagent"; subagent: ActivitySubagentWire; atMs: number };

export interface CachedFinishedSubagent {
  subagent: ActivitySubagentWire;
  /**
   * When THIS CLIENT noticed the subagent had vanished from the roster —
   * not the subagent's real finish time, which is unknowable client-side.
   * Named distinctly from `atMs` (used elsewhere in this module for real
   * times) so a future edit can't casually treat it as one.
   */
  detectedAtMs: number;
}

function latestExitedProcess(
  processes: readonly ActivityProcessWire[],
): { process: ActivityProcessWire; atMs: number } | null {
  let best: { process: ActivityProcessWire; atMs: number } | null = null;
  for (const process of processes) {
    if (isProcessRunning(process) || !process.endedAt) {
      continue;
    }
    const atMs = Date.parse(process.endedAt);
    if (!Number.isFinite(atMs)) {
      continue;
    }
    if (!best || atMs > best.atMs) {
      best = { process, atMs };
    }
  }
  return best;
}

function isUnseen(atMs: number, lastViewedAtMs: number | null): boolean {
  return lastViewedAtMs === null || atMs > lastViewedAtMs;
}

/**
 * The single piece of background work to surface for the active session —
 * the dot's dirty source and the banner's name. Counts (and therefore this
 * signal) never derive from tool-call status — same rule as
 * `deriveBackgroundWorkRowCounts`.
 *
 * Deterministic tiebreak (R5 review round 2 — MAJOR, see module docstring):
 * a process's real, unseen `endedAt` always wins over an unseen subagent
 * detection, never the reverse — an unknown-time detection must not outrank
 * a known-time finish. Only when there is no unseen process does an unseen
 * subagent detection surface at all.
 *
 * Residual, disclosed gap: if a subagent's TRUE finish was actually the
 * more recent event but its session was cold long enough that detection
 * lagged behind an unseen process's real `endedAt`, this still names the
 * process. We cannot safely compare a real time against an unknown one, and
 * arbitrarily preferring the known-real side is the safe-by-construction
 * choice — the alternative (trusting the detection time) is the routine
 * wrong-name bug this rewrite removes. This residual case is rare (requires
 * BOTH items unseen AND the subagent's session having gone cold) and
 * under-states rather than over-states freshness.
 */
export function deriveLatestBackgroundWorkFinishSignal({
  processes,
  cachedFinishedSubagent,
  lastViewedAtMs,
}: {
  processes: readonly ActivityProcessWire[];
  cachedFinishedSubagent: CachedFinishedSubagent | null;
  lastViewedAtMs: number | null;
}): BackgroundWorkFinishSignal | null {
  const processSignal = latestExitedProcess(processes);
  const subagentSignal: BackgroundWorkFinishSignal | null = cachedFinishedSubagent
    ? {
      kind: "subagent",
      subagent: cachedFinishedSubagent.subagent,
      atMs: cachedFinishedSubagent.detectedAtMs,
    }
    : null;

  const processUnseen = processSignal !== null && isUnseen(processSignal.atMs, lastViewedAtMs);
  if (processUnseen) {
    return { kind: "process", process: processSignal.process, atMs: processSignal.atMs };
  }

  const subagentUnseen = subagentSignal !== null && isUnseen(subagentSignal.atMs, lastViewedAtMs);
  if (subagentUnseen) {
    return subagentSignal;
  }

  // Nothing unseen — `deriveBackgroundWorkDirty` below will report false
  // for whichever of these is returned, so no caller renders it. Prefer the
  // real time over the unknown one for the same reason as above.
  if (processSignal) {
    return { kind: "process", process: processSignal.process, atMs: processSignal.atMs };
  }
  return subagentSignal;
}

/**
 * A pure timestamp comparison: dirty the instant something has finished
 * later than the last time it was viewed. `lastViewedAtMs === null` means
 * never viewed — anything finished at all counts as unseen.
 */
export function deriveBackgroundWorkDirty({
  latestFinishAtMs,
  lastViewedAtMs,
}: {
  latestFinishAtMs: number | null;
  lastViewedAtMs: number | null;
}): boolean {
  if (latestFinishAtMs === null) {
    return false;
  }
  if (lastViewedAtMs === null) {
    return true;
  }
  return latestFinishAtMs > lastViewedAtMs;
}
