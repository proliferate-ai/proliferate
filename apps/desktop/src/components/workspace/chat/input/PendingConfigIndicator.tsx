import type { PendingSessionConfigChangeStatus } from "@proliferate/product-domain/sessions/pending-config";
import { Clock } from "@proliferate/ui/icons";

interface PendingConfigIndicatorProps {
  pendingState: PendingSessionConfigChangeStatus | null;
  className?: string;
}

export function PendingConfigIndicator({
  pendingState,
  className = "size-3 shrink-0 text-muted-foreground/70",
}: PendingConfigIndicatorProps) {
  // Submitting renders nothing because the optimistically-updated control is itself the feedback;
  // queued keeps the clock because the change is waiting on the running turn.
  if (pendingState === "queued") {
    return <Clock className={className} />;
  }

  return null;
}
