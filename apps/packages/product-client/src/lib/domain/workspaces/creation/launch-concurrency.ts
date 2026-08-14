import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";

/**
 * How many launches may be starting at once.
 *
 * The limit is not a resource budget — it is a legibility one. Each starting
 * launch owns a sidebar row and a share of the machine, and past a handful the
 * sidebar stops reading as "these are starting" and starts reading as a list of
 * workspaces the user did not ask for. Five is where a column of spinners is
 * still countable at a glance.
 */
export const MAX_CONCURRENT_PENDING_LAUNCHES = 5;

/**
 * A failed attempt holds a sidebar row until it is dismissed, but it is not
 * starting anything, so it does not hold a launch slot. Counting it would let
 * five untouched failures lock the user out of launching at all.
 */
export function countStartingPendingLaunches(
  entries: readonly PendingWorkspaceEntry[],
): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.stage !== "failed") {
      count += 1;
    }
  }
  return count;
}

export function canBeginPendingLaunch(
  entries: readonly PendingWorkspaceEntry[],
): boolean {
  return countStartingPendingLaunches(entries) < MAX_CONCURRENT_PENDING_LAUNCHES;
}

/**
 * How long the same prompt is treated as one submit.
 *
 * Concurrent launches removed the in-flight lock, which was the only thing
 * stopping a double Enter (or a key repeat) from starting the same work twice.
 * The lock cannot come back — refusing a second launch is exactly what this
 * change exists to stop — so the guard narrows to what the lock was actually
 * catching: the identical prompt, submitted twice, faster than a person means
 * it. Two different prompts a millisecond apart are two launches.
 */
export const DUPLICATE_LAUNCH_SUBMIT_WINDOW_MS = 1000;

export interface LaunchSubmitFingerprint {
  prompt: string;
  at: number;
}

/** Whitespace and case are not what makes two submits different. */
export function launchSubmitFingerprint(text: string, at: number): LaunchSubmitFingerprint {
  return {
    prompt: text.trim().replace(/\s+/g, " ").toLowerCase(),
    at,
  };
}

export function isDuplicateLaunchSubmit(
  previous: LaunchSubmitFingerprint | null,
  next: LaunchSubmitFingerprint,
): boolean {
  return previous !== null
    && previous.prompt === next.prompt
    && next.at - previous.at < DUPLICATE_LAUNCH_SUBMIT_WINDOW_MS;
}
