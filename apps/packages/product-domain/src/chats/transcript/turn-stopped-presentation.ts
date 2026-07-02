import type { TurnRecord } from "@anyharness/sdk";

/**
 * Codex-style stopped-turn notice: a muted "You stopped after Ns" line with a
 * hairline divider, shown when the user cancelled the turn. Not an error —
 * error items keep their own presentation.
 */
export function resolveTurnStoppedNotice(turn: TurnRecord): string | null {
  if (turn.stopReason !== "cancelled" || !turn.completedAt) {
    return null;
  }
  const startedAt = Date.parse(turn.startedAt);
  const completedAt = Date.parse(turn.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) {
    return "You stopped";
  }
  const elapsedSeconds = Math.max(0, Math.round((completedAt - startedAt) / 1000));
  return elapsedSeconds > 0 ? `You stopped after ${formatStoppedDuration(elapsedSeconds)}` : "You stopped";
}

function formatStoppedDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
