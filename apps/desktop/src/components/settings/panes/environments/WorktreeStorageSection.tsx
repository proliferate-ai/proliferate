import { useEffect, useRef, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Minus, Plus } from "@proliferate/ui/icons";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SETTINGS_CONTROL_WIDTH_CLASS, SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { RuntimePressureDetailsDialog } from "@/components/workspace/chat/input/RuntimePressureDetailsDialog";
import { RuntimePressureRing } from "@/components/workspace/chat/input/RuntimePressureIndicator";
import { useWorktreeCleanupPolicy } from "@/hooks/workspaces/facade/use-worktree-cleanup-policy";
import {
  WORKTREE_AUTO_DELETE_LIMIT_MAX,
  WORKTREE_AUTO_DELETE_LIMIT_MIN,
} from "@/lib/domain/preferences/user/worktree-auto-delete";
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

const WORKTREE_POLICY_COMMIT_DELAY_MS = 600;

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
  const value = Number.isFinite(parsedDraft) ? parsedDraft : currentValue;
  const dirty = canApply && value !== currentValue;

  // Stepper clicks land in draft state; the commit (cloud PUT + preference
  // write) fires once clicking settles, replacing the old commit-on-blur.
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handle = window.setTimeout(() => onApplyRef.current(), WORKTREE_POLICY_COMMIT_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [dirty, value]);

  const step = (delta: number) => {
    const next = Math.min(
      WORKTREE_AUTO_DELETE_LIMIT_MAX,
      Math.max(WORKTREE_AUTO_DELETE_LIMIT_MIN, value + delta),
    );
    onDraftValueChange(String(next));
  };

  return (
    <SettingsRow
      label="Ideal worktrees"
      description="Per-repo target. Composer pressure warns above this count; cleanup skips dirty checkouts."
    >
      <div className="flex flex-col items-end gap-1">
        <div
          role="group"
          aria-label="Ideal worktrees per repo"
          className={`grid h-8 ${SETTINGS_CONTROL_WIDTH_CLASS} grid-cols-[2rem_minmax(0,1fr)_2rem] items-center overflow-hidden rounded-lg border border-transparent bg-foreground/5 text-foreground`}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fewer ideal worktrees"
            disabled={value <= WORKTREE_AUTO_DELETE_LIMIT_MIN}
            className="h-8 w-8 rounded-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={() => step(-1)}
          >
            <Minus className="size-3.5" />
          </Button>
          <div className="flex h-8 min-w-16 items-center justify-center border-x border-border-light px-3 text-ui font-medium tabular-nums text-foreground">
            {value} worktrees
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="More ideal worktrees"
            disabled={value >= WORKTREE_AUTO_DELETE_LIMIT_MAX}
            className="h-8 w-8 rounded-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={() => step(1)}
          >
            <Plus className="size-3.5" />
          </Button>
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
