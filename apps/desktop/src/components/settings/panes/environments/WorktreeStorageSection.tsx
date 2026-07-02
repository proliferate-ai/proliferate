import { useState, type KeyboardEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { RuntimePressureDetailsDialog } from "@/components/workspace/chat/input/RuntimePressureDetailsDialog";
import { RuntimePressureRing } from "@/components/workspace/chat/input/RuntimePressureIndicator";
import { useWorktreeCleanupPolicy } from "@/hooks/workspaces/facade/use-worktree-cleanup-policy";
import {
  type RuntimePressureTargetState,
  useRuntimePressureControlStateFromSettings,
} from "@/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { useWorktreeSettingsTargets } from "@/hooks/workspaces/facade/use-worktree-settings-targets";
import { useToastStore } from "@/stores/toast/toast-store";

export function WorktreeStorageSection() {
  const settings = useWorktreeSettingsTargets();
  const cleanupPolicy = useWorktreeCleanupPolicy(
    settings.targets,
    settings.syncPolicyToTarget,
  );
  const pressure = useRuntimePressureControlStateFromSettings(settings);
  const showToast = useToastStore((state) => state.show);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const selectedTarget = selectedTargetKey
    ? pressure.targets.find((targetState) => targetState.target.key === selectedTargetKey) ?? null
    : null;

  const applyPolicy = () => {
    void cleanupPolicy.apply().then(() => {
      showToast("Worktree preference updated.");
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  };

  return (
    <>
      <SettingsSection title="Worktrees" className="w-full">
        <WorktreePolicyRow
          draftValue={cleanupPolicy.draftValue}
          currentValue={cleanupPolicy.value}
          onDraftValueChange={cleanupPolicy.setDraftValue}
          canApply={cleanupPolicy.canApply && !cleanupPolicy.isApplying}
          applyDisabledReason={cleanupPolicy.applyDisabledReason}
          statusMessage={cleanupPolicy.statusMessage}
          onApply={applyPolicy}
        />
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

function WorktreePolicyRow({
  draftValue,
  currentValue,
  onDraftValueChange,
  canApply,
  applyDisabledReason,
  statusMessage,
  onApply,
}: {
  draftValue: string;
  currentValue: number;
  onDraftValueChange: (value: string) => void;
  canApply: boolean;
  applyDisabledReason: string | null;
  statusMessage: string | null;
  onApply: () => void;
}) {
  const helperText = applyDisabledReason ?? statusMessage;
  const parsedDraft = Number.parseInt(draftValue, 10);
  const commitIfChanged = () => {
    if (canApply && parsedDraft !== currentValue) {
      onApply();
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <SettingsRow
      label="Ideal worktrees"
      description="Per-repo target for managed worktrees. Composer pressure warns above this count; cleanup skips dirty checkouts."
    >
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <Input
            id="worktree-policy-global"
            aria-label="Ideal worktrees per repo"
            type="number"
            min={10}
            max={100}
            value={draftValue}
            onChange={(event) => onDraftValueChange(event.target.value)}
            onBlur={commitIfChanged}
            onKeyDown={handleKeyDown}
            className="h-8 w-20 text-right"
          />
          <span className="text-sm text-muted-foreground">worktrees</span>
        </div>
        {helperText ? (
          <p className="max-w-72 text-right text-sm text-muted-foreground">
            {helperText}
          </p>
        ) : null}
      </div>
    </SettingsRow>
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
        <span className="min-w-24 text-right text-sm tabular-nums text-foreground">
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
