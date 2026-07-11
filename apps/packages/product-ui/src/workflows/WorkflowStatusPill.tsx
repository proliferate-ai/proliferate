import type { WorkflowStatusTone } from "@proliferate/product-domain/workflows/run-status";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";

const TONE_TO_BADGE: Record<WorkflowStatusTone, BadgeTone> = {
  muted: "neutral",
  running: "info",
  positive: "success",
  attention: "warning",
  danger: "destructive",
};

export interface WorkflowStatusPillProps {
  label: string;
  tone: WorkflowStatusTone;
  /** Show a leading pulsing dot while the run is live. */
  live?: boolean;
  /** Native tooltip text (e.g. why a budget_blocked/missed run reads as it does). */
  title?: string | null;
  className?: string;
}

/** Small run-status pill (run header + Runs table). Presentational. */
export function WorkflowStatusPill({
  label,
  tone,
  live = false,
  title,
  className = "",
}: WorkflowStatusPillProps) {
  return (
    <Badge tone={TONE_TO_BADGE[tone]} title={title ?? undefined} className={`gap-1.5 text-xs ${className}`}>
      {live ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current animate-pulse motion-reduce:animate-none"
        />
      ) : null}
      {label}
    </Badge>
  );
}
