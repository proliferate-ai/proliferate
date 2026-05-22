import { Badge } from "@/components/ui/Badge";
import { ChevronRight } from "@/components/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  computeTargetKindLabel,
  computeTargetOwnerLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
} from "@/lib/domain/compute/target-presentation";
import {
  resolveComputeTargetAppearance,
  type ComputeTargetAppearancePreference,
} from "@/lib/domain/compute/target-appearance";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { ComputeTargetSwatch } from "./ComputeTargetSwatch";

interface ComputeTargetListProps {
  targets: ComputeTargetSummary[];
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
  selectedTargetId: string | null;
  loading: boolean;
  onSelectTarget: (targetId: string) => void;
  onAddSshTarget: () => void;
}

export function ComputeTargetList({
  targets,
  appearancePreferences,
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
          <p className="text-xs text-muted-foreground">
            Click a target to view and edit its configuration.
          </p>
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
        targets.map((target) => {
          const appearance = resolveComputeTargetAppearance({
            targetId: target.id,
            displayName: target.displayName,
            kind: target.kind,
            preference: appearancePreferences[target.id],
          });
          return (
            <Button
              key={target.id}
              type="button"
              variant="unstyled"
              size="unstyled"
              className={`flex min-h-[60px] w-full items-center justify-between gap-3 whitespace-normal rounded-none px-4 py-3 text-left transition-colors hover:bg-accent/50 ${
                selectedTargetId === target.id ? "bg-accent/40" : ""
              }`}
              onClick={() => onSelectTarget(target.id)}
            >
              <ComputeTargetSwatch appearance={appearance} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <span className="truncate">{appearance.displayName}</span>
                  <Badge tone={computeTargetStatusTone(target.status)}>
                    {computeTargetStatusLabel(target.status)}
                  </Badge>
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                  {computeTargetKindLabel(target.kind)}
                  {" · "}
                  {computeTargetOwnerLabel(target.ownerScope)}
                  {target.defaultWorkspaceRoot ? ` · ${target.defaultWorkspaceRoot}` : " · root not set"}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Button>
          );
        })
      )}
    </SettingsCard>
  );
}
