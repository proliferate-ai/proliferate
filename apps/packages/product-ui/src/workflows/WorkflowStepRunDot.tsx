import type { WorkflowStepDotKind } from "@proliferate/product-domain/workflows/run-status";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

const DOT_TONE: Record<WorkflowStepDotKind, string> = {
  pending: "text-muted-foreground",
  running: "text-info",
  success: "text-success",
  attention: "text-warning",
  failed: "text-destructive",
  skipped: "text-faint",
};

export interface WorkflowStepRunDotProps {
  kind: WorkflowStepDotKind;
  className?: string;
}

/** Status dot for a run-timeline step row. Pulses while running. */
export function WorkflowStepRunDot({ kind, className = "" }: WorkflowStepRunDotProps) {
  const hollow = kind === "pending" || kind === "skipped";
  const live = kind === "running";
  return (
    <span className={twMerge("inline-flex items-center", DOT_TONE[kind], className)} aria-hidden>
      <span
        className={twMerge(
          "size-2 shrink-0 rounded-full",
          hollow ? "border border-current bg-transparent" : "bg-current",
          live ? "animate-pulse motion-reduce:animate-none" : "",
        )}
      />
    </span>
  );
}
