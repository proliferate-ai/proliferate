import { Badge } from "@proliferate/ui/primitives/Badge";
import { ChevronRight, Server } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
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
    <SettingsCard>
      <div className="flex items-start justify-between gap-3 border-b border-border/40 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
            <Server className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">SSH Targets</h3>
              {!loading && targets.length > 0 ? (
                <Badge tone="neutral">{targetCountLabel(targets.length)}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Select an SSH target to inspect setup, readiness, local access, and auth.
            </p>
          </div>
        </div>
        {loading || targets.length > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={onAddSshTarget}>
            {COMPUTE_COPY.addSshTarget}
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          <TargetRowSkeleton />
          <TargetRowSkeleton />
        </div>
      ) : targets.length === 0 ? (
        <div className="space-y-3 p-4">
          <div className="rounded-md border border-dashed border-border/70 bg-foreground/5 p-4">
            <div className="text-sm font-medium text-foreground">{COMPUTE_COPY.emptyTitle}</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {COMPUTE_COPY.emptyDescription}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onAddSshTarget}>
            {COMPUTE_COPY.addSshTarget}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 p-3">
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
    </SettingsCard>
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
    <div className="space-y-2">
      <div className="space-y-0.5 px-1">
        <h4 className="text-base font-medium uppercase tracking-normal text-muted-foreground/90">
          {group.label}
        </h4>
        <p className="text-xs leading-5 text-muted-foreground">{group.description}</p>
      </div>
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
    </div>
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

function targetCountLabel(count: number) {
  return count === 1 ? "1 target" : `${count} targets`;
}
