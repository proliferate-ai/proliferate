/**
 * Counts for `BackgroundWorkTranscriptRow` — the quiet transcript-tail line
 * that replaces the docked activity chips (Design Handoff —
 * HANDOFF-background-work.md, NEW `BackgroundWorkTranscriptRow`). Reads the
 * SAME roster chip descriptors `SessionActivityBar` used to feed the retired
 * `ActivityChips`, so the row and the roster never disagree.
 */

import type { ActivityChipDescriptor } from "./chips";

export interface BackgroundWorkRowCounts {
  /** Still-live processes + running native subagents (armed loops are descoped for this row). */
  runningCount: number;
  /**
   * Processes that finished but remain roster-inspectable (processes never
   * leave the roster — session-activity-architecture). Native subagents leave
   * the roster the instant they finish, so they carry no lingering signal
   * here; a durable "N finished" tally across a subagent's disappearance is
   * the finish-signal ladder's job (delivery spec rung R5), not this row's
   * count source.
   */
  finishedCount: number;
}

/**
 * Counts come from the roster, never from tool-call status: a launched tool
 * call never reports "finished", and `session/cancel` does not stop
 * background work, so this must survive both (locked design, HANDOFF
 * "Decisions that stuck"). Armed loops are dropped from the sum entirely —
 * loops are descoped for the transcript row.
 */
export function deriveBackgroundWorkRowCounts(
  chips: readonly ActivityChipDescriptor[],
): BackgroundWorkRowCounts {
  let runningCount = 0;
  let finishedCount = 0;
  for (const chip of chips) {
    if (chip.kind === "loops") {
      continue;
    }
    runningCount += chip.liveCount;
    if (chip.kind === "terminals") {
      finishedCount += chip.count - chip.liveCount;
    }
  }
  return { runningCount, finishedCount };
}
