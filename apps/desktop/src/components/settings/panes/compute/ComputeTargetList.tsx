import { Badge } from "@proliferate/ui/primitives/Badge";
import { ChevronRight } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import {
  computeTargetKindLabel,
  computeTargetOwnerLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
  groupComputeTargetsByOwnerScope,
  type ComputeTargetOwnerGroup,
} from "@/lib/domain/compute/target-presentation";
import {
  resolveComputeTargetAppearance,
  type ComputeTargetAppearancePreference,
} from "@/lib/domain/compute/target-appearance";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";

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
  const targetGroups = groupComputeTargetsByOwnerScope(targets);

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="space-y-2">
          <TargetRowSkeleton />
          <TargetRowSkeleton />
        </div>
      ) : targets.length === 0 ? (
        <SettingsEmptyState
          size="compact"
          title={COMPUTE_COPY.emptyTitle}
          description={COMPUTE_COPY.emptyDescription}
          action={(
            <Button type="button" variant="secondary" onClick={onAddSshTarget}>
              {COMPUTE_COPY.addSshTarget}
            </Button>
          )}
        />
      ) : (
        <div className="space-y-6">
          {targetGroups.map((group) => (
            <TargetGroup
              key={group.id}
              group={group}
              appearancePreferences={appearancePreferences}
              selectedTargetId={selectedTargetId}
              onSelectTarget={onSelectTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TargetGroup({
  group,
  appearancePreferences,
  selectedTargetId,
  onSelectTarget,
}: {
  group: ComputeTargetOwnerGroup;
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
  selectedTargetId: string | null;
  onSelectTarget: (targetId: string) => void;
}) {
  return (
    <SettingsSection title={group.label} description={group.description}>
      <div className="space-y-2">
        {group.targets.map((target) => (
          <TargetRow
            key={target.id}
            target={target}
            appearancePreferences={appearancePreferences}
            selected={selectedTargetId === target.id}
            onSelectTarget={onSelectTarget}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

function TargetRow({
  target,
  appearancePreferences,
  selected,
  onSelectTarget,
}: {
  target: ComputeTargetSummary;
  appearancePreferences: Record<string, ComputeTargetAppearancePreference>;
  selected: boolean;
  onSelectTarget: (targetId: string) => void;
}) {
  const appearance = resolveComputeTargetAppearance({
    targetId: target.id,
    displayName: target.displayName,
    kind: target.kind,
    preference: appearancePreferences[target.id],
  });

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-pressed={selected}
      className={`group/target flex min-h-[74px] w-full items-center justify-between gap-3 whitespace-normal rounded-md border px-3 py-3 text-left transition-colors ${
        selected
          ? "border-border bg-accent text-accent-foreground shadow-subtle"
          : "border-border/50 bg-foreground/5 hover:border-border hover:bg-foreground/10"
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
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{computeTargetKindLabel(target.kind)}</span>
          <span aria-hidden="true">·</span>
          <span>{computeTargetOwnerLabel(target.ownerScope)}</span>
        </span>
        <span className="mt-1 block truncate font-mono text-base text-muted-foreground">
          {target.defaultWorkspaceRoot ?? "Workspace root not set"}
        </span>
      </span>
      <ChevronRight
        className={`size-4 shrink-0 transition-colors ${
          selected ? "text-foreground" : "text-muted-foreground group-hover/target:text-foreground"
        }`}
        aria-hidden="true"
      />
    </Button>
  );
}

function TargetRowSkeleton() {
  return (
    <div className="flex min-h-[74px] items-center gap-3 rounded-md border border-border/40 bg-foreground/5 px-3 py-3">
      <div className="size-8 shrink-0 rounded-lg bg-foreground/10" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-1/2 rounded-full bg-foreground/10" />
        <div className="h-2.5 w-3/4 rounded-full bg-foreground/10" />
      </div>
    </div>
  );
}

