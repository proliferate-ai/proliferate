import { Badge } from "@/components/ui/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  computeTargetKindLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
} from "@/lib/domain/compute/target-presentation";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";
import { COMPUTE_COPY } from "@/copy/settings/compute";

interface ComputeTargetListProps {
  targets: ComputeTargetSummary[];
  selectedTargetId: string | null;
  loading: boolean;
  onSelectTarget: (targetId: string) => void;
  onAddSshTarget: () => void;
}

export function ComputeTargetList({
  targets,
  selectedTargetId,
  loading,
  onSelectTarget,
  onAddSshTarget,
}: ComputeTargetListProps) {
  return (
    <SettingsCard>
      <div className="flex items-center justify-between gap-3 p-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Targets</h3>
          <p className="text-xs text-muted-foreground">Cloud-dispatchable machines and runtimes.</p>
        </div>
        <Button type="button" variant="secondary" onClick={onAddSshTarget}>
          {COMPUTE_COPY.addSshTarget}
        </Button>
      </div>
      {loading ? (
        <div className="p-3 text-sm text-muted-foreground">Loading targets...</div>
      ) : targets.length === 0 ? (
        <div className="space-y-2 p-3">
          <div className="text-sm font-medium text-foreground">{COMPUTE_COPY.emptyTitle}</div>
          <p className="text-sm text-muted-foreground">{COMPUTE_COPY.emptyDescription}</p>
        </div>
      ) : (
        targets.map((target) => (
          <button
            key={target.id}
            type="button"
            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50 ${
              selectedTargetId === target.id ? "bg-accent/40" : ""
            }`}
            onClick={() => onSelectTarget(target.id)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {target.displayName}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {computeTargetKindLabel(target.kind)}
                {target.defaultWorkspaceRoot ? ` · ${target.defaultWorkspaceRoot}` : ""}
              </span>
            </span>
            <Badge tone={computeTargetStatusTone(target.status)}>
              {computeTargetStatusLabel(target.status)}
            </Badge>
          </button>
        ))
      )}
    </SettingsCard>
  );
}
