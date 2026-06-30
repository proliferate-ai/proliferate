import { useState } from "react";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import {
  type RuntimePressureTargetState,
  type RuntimePressureTone,
  useRuntimePressureControlState,
} from "@/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { RuntimePressureDetailsDialog } from "./RuntimePressureDetailsDialog";

export function RuntimePressureIndicator() {
  const pressure = useRuntimePressureControlState();
  const [open, setOpen] = useState(false);

  if (!pressure.visible || !pressure.indicator) {
    return null;
  }

  const indicator = pressure.indicator;
  const tooltip = compactPressureTooltip(indicator);

  return (
    <>
      <Tooltip content={tooltip}>
        <ComposerControlButton
          iconOnly
          tone="quiet"
          label="Workspace pressure"
          aria-label="Open pruning details"
          aria-haspopup="dialog"
          aria-expanded={open}
          icon={(
            <RuntimePressureRing
              tone={indicator.tone}
              progressPercent={indicator.ringProgressPercent}
              loading={pressure.isDiscovering || indicator.isLoading}
            />
          )}
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <RuntimePressureDetailsDialog
        open={open}
        targetState={indicator}
        actions={pressure.actions}
        onClose={() => setOpen(false)}
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
