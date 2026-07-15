import { useState } from "react";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  type RuntimePressureTargetState,
  type RuntimePressureTone,
  useRuntimePressureControlState,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import {
  EnvironmentStatusCard,
  type EnvironmentCardActions,
} from "#product/components/workspace/chat/input/EnvironmentStatusCard";

/**
 * The composer's environment control: the pressure ring stays the trigger,
 * but it now opens a composer-anchored card (EnvironmentStatusCard) instead
 * of the old worktree-table modal — worktrees + runtime pressure + the
 * session's advanced config (absorbed from the old "..." overflow menu).
 */
export function RuntimePressureIndicator({
  advancedControls = [],
  agentKind = null,
}: {
  advancedControls?: LiveSessionControlDescriptor[];
  agentKind?: string | null;
}) {
  const pressure = useRuntimePressureControlState();

  const indicator = pressure.visible ? pressure.indicator : null;
  // Advanced config must stay reachable even when no runtime target reports
  // pressure (the ring just renders quiet/empty).
  if (!indicator && advancedControls.length === 0) {
    return null;
  }

  return (
    <RuntimeEnvironmentControl
      targetState={indicator}
      loading={pressure.isDiscovering || !!indicator?.isLoading}
      actions={pressure.actions}
      advancedControls={advancedControls}
      agentKind={agentKind}
    />
  );
}

/** Pure control (trigger + card + purge confirm) — playground renders this
 * directly with fixture state. */
export function RuntimeEnvironmentControl({
  targetState,
  loading = false,
  actions,
  advancedControls,
  agentKind,
}: {
  targetState: RuntimePressureTargetState | null;
  loading?: boolean;
  actions: EnvironmentCardActions;
  advancedControls: LiveSessionControlDescriptor[];
  agentKind: string | null;
}) {
  const [confirmPurge, setConfirmPurge] = useState<{
    workspaceId: string;
    label: string;
  } | null>(null);

  const tooltip = targetState
    ? compactPressureTooltip(targetState)
    : "Environment & advanced options";

  return (
    <>
      <PopoverButton
        trigger={(
          <ComposerControlButton
            iconOnly
            label="Environment"
            aria-label="Open environment details"
            title={tooltip}
            icon={(
              <RuntimePressureRing
                tone={targetState?.tone ?? "quiet"}
                progressPercent={targetState?.ringProgressPercent}
                loading={loading}
              />
            )}
          />
        )}
        side="top"
        align="end"
        offset={8}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        {() => (
          <EnvironmentStatusCard
            targetState={targetState}
            advancedControls={advancedControls}
            agentKind={agentKind}
            onRequestPurge={(workspaceId, label) => setConfirmPurge({ workspaceId, label })}
            onDeleteOrphan={(path) => {
              if (targetState) {
                actions.pruneOrphan(targetState.target, { path });
              }
            }}
          />
        )}
      </PopoverButton>
      <ConfirmationDialog
        open={confirmPurge !== null}
        title={`Delete runtime history for ${confirmPurge?.label ?? "this workspace"}?`}
        description="This permanently deletes the AnyHarness runtime workspace record, chats, raw events, normalized events, checkout, and local agent artifacts for this runtime. Git commits, branches, pull requests, and Cloud product records are preserved."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onClose={() => setConfirmPurge(null)}
        onConfirm={() => {
          const pending = confirmPurge;
          if (!pending || !targetState) {
            return;
          }
          setConfirmPurge(null);
          actions.purgeWorkspace(targetState.target, pending.workspaceId);
        }}
      />
    </>
  );
}

export function RuntimePressureRing({
  tone,
  progressPercent,
  loading = false,
}: {
  tone: RuntimePressureTone;
  progressPercent?: number | null;
  loading?: boolean;
}) {
  const classes = {
    success: "stroke-success/55",
    warning: "stroke-warning/60",
    destructive: "stroke-destructive/60",
    quiet: "stroke-muted-foreground/45",
  } satisfies Record<RuntimePressureTone, string>;
  const progress = typeof progressPercent === "number" && Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : 0;

  return (
    <svg
      viewBox="0 0 16 16"
      className={`block size-4 ${
        loading ? "animate-pulse" : ""
      }`}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        strokeWidth="2"
        className="fill-none stroke-muted-foreground/20"
      />
      <circle
        cx="8"
        cy="8"
        r="6"
        pathLength="100"
        strokeDasharray={`${progress} ${100 - progress}`}
        strokeLinecap="round"
        strokeWidth="2"
        transform="rotate(-90 8 8)"
        className={`fill-none transition-[stroke-dasharray] ${classes[tone]}`}
      />
    </svg>
  );
}

function formatRuntimePercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "Unavailable";
}

function formatRingProgress(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "unknown";
}

function compactPressureTooltip(targetState: RuntimePressureTargetState): string {
  const lines = [targetState.target.label];
  if (targetState.target.location === "cloud") {
    lines.push([
      `CPU ${formatRuntimePercent(targetState.resourcePressure?.cpu?.normalizedPercent)}`,
      `RAM ${formatRuntimePercent(targetState.resourcePressure?.memory?.percent)}`,
    ].join(" · "));
    if (targetState.pressurePercent !== null) {
      lines.push(`${formatRuntimePercent(targetState.pressurePercent)} pressure`);
    }
  } else {
    lines.push(
      `${targetState.worktreeCount}/${targetState.idealWorktreeCount} worktrees · ${formatRingProgress(targetState.ringProgressPercent)} of ideal`,
    );
  }
  lines.push("Click for details.");
  return lines.join("\n");
}
