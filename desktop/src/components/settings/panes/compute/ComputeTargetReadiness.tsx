import { Badge } from "@/components/ui/Badge";
import { computeTargetReadiness } from "@/lib/domain/compute/target-readiness";
import type { ComputeTargetInventory } from "@/lib/domain/compute/target-types";

interface ComputeTargetReadinessProps {
  inventory: ComputeTargetInventory | null | undefined;
}

export function ComputeTargetReadiness({ inventory }: ComputeTargetReadinessProps) {
  const items = computeTargetReadiness(inventory);
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Readiness
      </h4>
      <div className="divide-y divide-border/40 rounded-md border border-border/60">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{item.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
            </div>
            <Badge tone={item.ready ? "success" : "warning"}>
              {item.ready ? "Ready" : "Missing"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
