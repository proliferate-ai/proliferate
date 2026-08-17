/**
 * Finish-signal ladder (rungs 1-3): the pane's tab dot and its in-pane
 * `NoticeBanner` both need to know "what was the most recent piece of
 * background work to finish, and is it newer than the last time this was
 * viewed" (Design Handoff — HANDOFF-background-work.md, "Finish signals are
 * a ladder"; Delivery Spec — Background Work Slice 1, rung R5).
 *
 * Processes never leave the roster (session-activity-architecture), so their
 * `endedAt` is read straight off the live roster — no separate tracking
 * needed. Native subagents DO leave the roster the instant they finish, so
 * the only record of a subagent's finish is whatever
 * `useBackgroundWorkFinishSignalTracking` observed at the moment it
 * disappeared; that observation is cached by session in the workspace UI
 * store and read back in here as `cachedFinishedSubagent`.
 */

import type { ActivityProcessWire } from "./process";
import { isProcessRunning } from "./process";
import type { ActivitySubagentWire } from "./subagent";

export type BackgroundWorkFinishSignal =
  | { kind: "process"; process: ActivityProcessWire; atMs: number }
  | { kind: "subagent"; subagent: ActivitySubagentWire; atMs: number };

export interface CachedFinishedSubagent {
  subagent: ActivitySubagentWire;
  atMs: number;
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

/**
 * The most recent piece of background work to finish for the active
 * session, whichever of the two sources is newer. Counts (and therefore this
 * signal) never derive from tool-call status — same rule as
 * `deriveBackgroundWorkRowCounts`.
 */
export function deriveLatestBackgroundWorkFinishSignal({
  processes,
  cachedFinishedSubagent,
}: {
  processes: readonly ActivityProcessWire[];
  cachedFinishedSubagent: CachedFinishedSubagent | null;
}): BackgroundWorkFinishSignal | null {
  const processSignal = latestExitedProcess(processes);
  const subagentSignal: BackgroundWorkFinishSignal | null = cachedFinishedSubagent
    ? {
      kind: "subagent",
      subagent: cachedFinishedSubagent.subagent,
      atMs: cachedFinishedSubagent.atMs,
    }
    : null;

  if (processSignal && subagentSignal) {
    return processSignal.atMs >= subagentSignal.atMs
      ? { kind: "process", process: processSignal.process, atMs: processSignal.atMs }
      : subagentSignal;
  }
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
