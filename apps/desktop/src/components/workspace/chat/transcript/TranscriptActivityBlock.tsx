import type { ReactNode } from "react";
import { useTranscriptEntryMotion } from "./TranscriptEntryMotionContext";

/**
 * Marker wrapper for activity content (tool calls, thinking, collapsed
 * actions). It carries no external vertical padding: sibling spacing comes
 * solely from the parent turn container's gap.
 */
export function TranscriptActivityBlock({
  children,
  entryItemId = null,
  animateEntry = false,
}: {
  children: ReactNode;
  entryItemId?: string | null;
  animateEntry?: boolean;
}) {
  const shouldAnimateEntry = useTranscriptEntryMotion(entryItemId, animateEntry);

  return (
    <div
      data-transcript-activity-shell
      data-transcript-activity-block
      data-transcript-activity-entry={shouldAnimateEntry ? "true" : undefined}
      className={shouldAnimateEntry ? "animate-transcript-activity-in" : undefined}
    >
      {children}
    </div>
  );
}
