import { Badge } from "@proliferate/ui/primitives/Badge";
import { computeTargetReadiness } from "@/lib/domain/compute/target-readiness";
import type {
  ComputeRuntimeConfigStatus,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

interface ComputeTargetReadinessProps {
  target: ComputeTargetSummary;
  runtimeConfigStatus?: ComputeRuntimeConfigStatus | null;
  loadingRuntimeConfig?: boolean;
}

const READINESS_TONE: Record<
  ReturnType<typeof computeTargetReadiness>[number]["status"],
  "success" | "warning" | "neutral" | "destructive"
> = {
  ready: "success",
  pending: "warning",
  missing: "warning",
  unavailable: "neutral",
};

export function ComputeTargetReadiness({
  target,
  runtimeConfigStatus = null,
  loadingRuntimeConfig = false,
}: ComputeTargetReadinessProps) {
  const items = computeTargetReadiness(target, {
    runtimeConfigStatus,
    loadingRuntimeConfig,
  });
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-foreground">Readiness</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Tooling and target state required for cloud-dispatched work.
        </p>
      </div>
      <div className="divide-y divide-border/40 rounded-md border border-border/60 bg-foreground/5">
        {items.map((item) => {
          const badgeLabel = readinessLabel(item);
          return (
            <div key={item.key} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{item.detail}</div>
              </div>
              <Badge tone={READINESS_TONE[item.status]}>{badgeLabel}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function readinessLabel(item: ReturnType<typeof computeTargetReadiness>[number]): string {
  if (item.status === "ready") {
    return item.key === "git" || item.key === "node" || item.key === "python"
      ? "Installed"
      : "Ready";
  }
  if (item.status === "pending") {
    return "Pending";
  }
  if (item.status === "missing") {
    return "Missing";
  }
  return "Unavailable";
}
