import type { ReactNode } from "react";
import { ProliferateIcon } from "#product/primitives/icons/proliferate-icons";
import { Button } from "#product/primitives/Button";

export interface BackgroundWorkTranscriptRowProps {
  /** Still-live processes + running native subagents. */
  runningCount: number;
  /** Opens the Background work pane. */
  onOpen: () => void;
}

function pluralizeTask(count: number): string {
  return `${count} background task${count === 1 ? "" : "s"}`;
}

/**
 * The quiet line at the end of the transcript reporting live background work
 * (running bash processes + running native subagents — loops are descoped) and
 * opening the Background work pane on click (Design Handoff —
 * HANDOFF-background-work.md, NEW `BackgroundWorkTranscriptRow`; Delivery Spec
 * — Background Work Slice 1, rung R1).
 *
 * Founder ruling (2026-08-17, bgwork r6): this row counts RUNNING work only,
 * and is NOT rendered at count 0. Completed tasks leave the count; the row
 * disappears at 0. There is no settled/finished display state — completed work
 * is announced solely by the inline `BackgroundCompletionReceipt` rows. The
 * earlier "N background tasks finished" + `CircleCheck` swap is removed
 * entirely.
 *
 * No motion: a spinner and the `ProliferateLivingMark` breathing treatment were
 * both tried and rejected. The glyph is static; the mark and the label always
 * share one hover treatment.
 */
export function BackgroundWorkTranscriptRow({
  runningCount,
  onOpen,
}: BackgroundWorkTranscriptRowProps): ReactNode {
  if (runningCount <= 0) {
    return null;
  }

  const label = pluralizeTask(runningCount);
  const toneClassName =
    "text-muted-foreground transition-colors duration-hover group-hover:text-foreground";

  return (
    <Button
      variant="unstyled"
      size="unstyled"
      type="button"
      onClick={onOpen}
      className="group flex w-fit items-center gap-2 rounded-md text-chat"
    >
      <span className={toneClassName}>
        <ProliferateIcon className="icon-paired [font-size:var(--text-chat)]" aria-hidden />
      </span>
      <span className={toneClassName}>{label}</span>
    </Button>
  );
}
