import type { PendingSessionConfigChangeStatus } from "@proliferate/product-domain/sessions/pending-config";
import { Clock, Spinner } from "@/components/ui/icons";

interface PendingConfigIndicatorProps {
  pendingState: PendingSessionConfigChangeStatus | null;
  className?: string;
}

export function PendingConfigIndicator({
  pendingState,
  className = "size-3 shrink-0 text-muted-foreground/70",
}: PendingConfigIndicatorProps) {
  if (pendingState === "submitting") {
    return <Spinner className={className} />;
  }

  if (pendingState === "queued") {
    return <Clock className={className} />;
  }

  return null;
}
