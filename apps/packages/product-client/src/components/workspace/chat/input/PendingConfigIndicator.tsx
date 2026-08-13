import type { PendingSessionConfigChangeStatus } from "#product/domain/sessions/pending-config";
import { Clock } from "#product/primitives/icons/core";

interface PendingConfigIndicatorProps {
  pendingState: PendingSessionConfigChangeStatus | null;
  className?: string;
}

/**
 * True when the pending state renders a visible glyph. Submitting and
 * settling are deliberately invisible — the optimistically-updated control is
 * itself the feedback — so callers must gate their trailing slot on this
 * instead of on `pendingState` being set: a trailing wrapper around a
 * null-rendering indicator is a zero-width flex item that still claims the
 * pill's gap and pushes an icon-only control off-center.
 */
export function showsPendingConfigIndicator(
  pendingState: PendingSessionConfigChangeStatus | null,
): boolean {
  return pendingState === "queued";
}

export function PendingConfigIndicator({
  pendingState,
  className = "size-3 shrink-0 text-muted-foreground/70",
}: PendingConfigIndicatorProps) {
  // Queued keeps the clock because the change is waiting on the running turn.
  if (!showsPendingConfigIndicator(pendingState)) {
    return null;
  }

  return <Clock className={className} />;
}
