import type { ReactNode } from "react";
import { ProliferateIcon } from "#product/primitives/icons/proliferate-icons";
import { CircleCheck } from "#product/primitives/icons/status";
import { Button } from "#product/primitives/Button";
import { twMerge } from "#product/primitives/utils/tw-merge";

export interface BackgroundWorkTranscriptRowProps {
  /** Still-live processes + running native subagents. */
  runningCount: number;
  /** Finished work still worth reporting once nothing is running. */
  finishedCount: number;
  /**
   * Opens the Background work pane. R1 ships only this row; the pane itself
   * lands in R2, so callers wire a no-op seam until then — see the
   * `onOpen={backgroundWorkPaneSeam}` call site.
   */
  onOpen: () => void;
}

function pluralizeTask(count: number): string {
  return `${count} background task${count === 1 ? "" : "s"}`;
}

/**
 * The quiet line at the end of the transcript reporting live background work
 * (running bash processes + running native subagents — loops are descoped)
 * and opening the Background work pane on click (Design Handoff —
 * HANDOFF-background-work.md, NEW `BackgroundWorkTranscriptRow`; Delivery
 * Spec — Background Work Slice 1, rung R1). Replaces the docked
 * `ActivityChips` breakdown with one aggregate line — no "running", no
 * "2 terminals, 1 subagent" tail.
 *
 * No motion in either state: a spinner and the `ProliferateLivingMark`
 * breathing treatment were both tried and rejected. The glyph is static and
 * swaps to `CircleCheck` once settled; the mark and the label always share
 * one hover treatment.
 */
export function BackgroundWorkTranscriptRow({
  runningCount,
  finishedCount,
  onOpen,
}: BackgroundWorkTranscriptRowProps): ReactNode {
  const running = runningCount > 0;
  if (!running && finishedCount <= 0) {
    return null;
  }

  const label = running
    ? pluralizeTask(runningCount)
    : `${pluralizeTask(finishedCount)} finished`;

  // Settled state rests at `text-faint` instead of `text-muted-foreground`;
  // both states share the same hover treatment (mark + label light together).
  const toneClassName = twMerge(
    running ? "text-muted-foreground" : "text-faint",
    "transition-colors duration-hover group-hover:text-foreground",
  );

  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      onClick={onOpen}
      className="group flex w-fit items-center gap-2 rounded-md text-chat"
    >
      <span className={toneClassName}>
        {running ? (
          <ProliferateIcon className="icon-paired [font-size:var(--text-chat)]" aria-hidden />
        ) : (
          <CircleCheck className="icon-paired [font-size:var(--text-chat)]" aria-hidden />
        )}
      </span>
      <span className={toneClassName}>{label}</span>
    </Button>
  );
}
