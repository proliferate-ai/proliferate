import type { PendingSessionConfigChangeStatus } from "@/lib/domain/sessions/pending-config";
import { Clock, LoaderCircle } from "@/components/ui/icons";

interface PendingConfigIndicatorProps {
  pendingState: PendingSessionConfigChangeStatus | null;
  className?: string;
}

export function PendingConfigIndicator({
  pendingState,
  className = "size-3 shrink-0 text-muted-foreground/70",
}: PendingConfigIndicatorProps) {
  if (pendingState === "submitting") {
    return <LoaderCircle className={`${className} animate-spin`} />;
  }

  if (pendingState === "queued") {
    return <Clock className={className} />;
  }

  return null;
}
