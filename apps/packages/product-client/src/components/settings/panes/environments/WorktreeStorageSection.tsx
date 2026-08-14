import { useState } from "react";
import { Button } from "#product/primitives/Button";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { RuntimePressureDetailsDialog } from "#product/components/workspace/chat/input/RuntimePressureDetailsDialog";
import { RuntimePressureRing } from "#product/components/workspace/chat/input/RuntimePressureIndicator";
import {
  type RuntimePressureTargetState,
  useRuntimePressureControlStateFromSettings,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { useWorktreeSettingsTargets } from "#product/hooks/workspaces/facade/use-worktree-settings-targets";

export function WorktreeStorageSection() {
  const settings = useWorktreeSettingsTargets();
  const pressure = useRuntimePressureControlStateFromSettings(settings);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const selectedTarget = selectedTargetKey
    ? pressure.targets.find((targetState) => targetState.target.key === selectedTargetKey) ?? null
    : null;


  return (
    <>
      <SettingsSection title="Worktrees" className="w-full">
        {pressure.isDiscovering && pressure.targets.length === 0 ? (
          <SettingsRow
            label="Runtime status"
            description="Looking for runtimes…"
          />
        ) : pressure.targets.length === 0 ? (
          <SettingsRow
            label="Runtime status"
            description="No runtime roots found."
          />
        ) : (
          pressure.targets.map((targetState) => (
            <WorktreeRuntimeStatusRow
              key={targetState.target.key}
              targetState={targetState}
              onOpenDetails={() => setSelectedTargetKey(targetState.target.key)}
            />
          ))
        )}
      </SettingsSection>

      {selectedTarget ? (
        <RuntimePressureDetailsDialog
          open
          targetState={selectedTarget}
          actions={pressure.actions}
          onClose={() => setSelectedTargetKey(null)}
        />
      ) : null}
    </>
  );
}

function WorktreeRuntimeStatusRow({
  targetState,
  onOpenDetails,
}: {
  targetState: RuntimePressureTargetState;
  onOpenDetails: () => void;
}) {
  return (
    <SettingsRow
      label={targetState.target.label}
      description={runtimeStatusDescription(targetState)}
    >
      <div className="flex items-center gap-3">
        <RuntimePressureRing
          tone={targetState.tone}
          progressPercent={targetState.ringProgressPercent}
          loading={targetState.isLoading}
        />
        <span className="min-w-24 text-right text-body-emphasis tabular-nums text-foreground">
          {targetState.isLoading ? "Loading" : targetState.pressureLabel}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenDetails}
        >
          Details
        </Button>
      </div>
    </SettingsRow>
  );
}

function runtimeStatusDescription(targetState: RuntimePressureTargetState): string {
  if (targetState.error) {
    return "Runtime inventory is unavailable.";
  }
  if (targetState.isLoading) {
    return "Loading worktree status…";
  }
  if (targetState.target.location === "cloud") {
    return targetState.detailLines.join(" · ");
  }
  return targetState.detailLines.slice(0, 2).join(" · ");
}
