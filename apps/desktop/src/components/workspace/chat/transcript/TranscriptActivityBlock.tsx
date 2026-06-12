import type { ReactNode } from "react";

/**
 * Marker wrapper for activity content (tool calls, thinking, collapsed
 * actions). It carries no external vertical padding: sibling spacing comes
 * solely from the parent turn container's gap.
 */
export function TranscriptActivityBlock({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      data-transcript-activity-shell
      data-transcript-activity-block
    >
      {children}
    </div>
  );
}
