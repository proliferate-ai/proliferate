import type { ReactNode } from "react";
import {
  type WorkflowStepOutputChip,
  type WorkflowStepRunView,
  type WorkflowStepSessionLink,
} from "@proliferate/product-domain/workflows/run-status";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { ArrowUpRight, ExternalLink, RefreshCw } from "@proliferate/ui/icons";
import { WorkflowStepRunDot } from "./WorkflowStepRunDot";

/**
 * Quiet typed output chip (Family-5 B): border + text tone only, no heavy fill,
 * so the status spine and goal counters carry the row, not a chip cluster.
 */
function OutputChip({ chip }: { chip: WorkflowStepOutputChip }) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-none tabular-nums";
  switch (chip.kind) {
    case "exit":
      return (
        <span className={twMerge(base, chip.ok ? "border-success/30 text-success" : "border-destructive/35 text-destructive")}>
          {chip.label}
        </span>
      );
    case "pr":
      return chip.href ? (
        <a
          href={chip.href}
          target="_blank"
          rel="noreferrer"
          className={twMerge(base, "border-info/30 text-info hover:underline")}
        >
          {chip.label}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : (
        <span className={twMerge(base, "border-info/30 text-info")}>{chip.label}</span>
      );
    case "notify":
      return (
        <span className={twMerge(base, chip.delivered ? "border-border text-muted-foreground" : "border-border text-faint")}>
          {chip.label}
        </span>
      );
    case "approval":
      return (
        <span className={twMerge(base, chip.approved ? "border-success/30 text-success" : "border-destructive/35 text-destructive")}>
          {chip.label}
        </span>
      );
    case "text":
      return <span className={twMerge(base, "border-border text-muted-foreground")}>{chip.label}</span>;
  }
}

/** Quiet progress chip for the live goal row (Family-1 B). */
function QuietChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-elevated-secondary px-2 py-0.5 text-xs tabular-nums text-faint ring-1 ring-inset ring-border/60">
      {children}
    </span>
  );
}

export interface WorkflowRunTimelineRowProps {
  view: WorkflowStepRunView;
  /** One-line content preview of the step (from the definition). */
  preview?: string | null;
  durationLabel?: string | null;
  /** Deep-link into the workspace/session view for an agent step (spec 3.6). */
  onOpenSession?: (link: WorkflowStepSessionLink) => void;
  /** Inline approve/deny controls for a waiting_approval step. */
  approvalControls?: ReactNode;
  /** Draw the connector line down to the next row. */
  connector?: boolean;
  className?: string;
}

/**
 * One step row in the run-view timeline (spec 3.6, "Family-5 B"): a quiet status
 * spine, a light list row (kind label + faint preview, no pill), typed output
 * chips right-aligned, and — for a goal-iterating prompt — a live goal-counter
 * line with a pulsing dot and right-aligned [⟳ n][tok] chips. Presentational.
 */
export function WorkflowRunTimelineRow({
  view,
  preview,
  durationLabel,
  onOpenSession,
  approvalControls,
  connector = false,
  className = "",
}: WorkflowRunTimelineRowProps) {
  const goal = view.goalLine;
  const pending = view.dotKind === "pending";
  return (
    <div className={twMerge("flex gap-3", className)}>
      <div className="flex flex-col items-center pt-[7px]">
        <WorkflowStepRunDot kind={view.dotKind} />
        {connector ? <span className="mt-1.5 w-px flex-1 bg-border" aria-hidden /> : null}
      </div>
      <div className={twMerge("min-w-0 flex-1", connector ? "pb-4" : "")}>
        <div className="flex min-w-0 items-center gap-2 leading-6">
          <span className={twMerge("shrink-0 text-sm font-medium", pending ? "text-faint" : "text-foreground")}>
            {view.label}
          </span>
          {preview ? (
            <span className="min-w-0 flex-1 truncate text-xs text-faint" data-telemetry-mask>
              {preview}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <span className="flex shrink-0 items-center gap-1.5">
            {view.chips.map((chip, index) => (
              <OutputChip key={index} chip={chip} />
            ))}
            {durationLabel ? (
              <span className="font-mono text-[11px] tabular-nums text-faint">{durationLabel}</span>
            ) : null}
          </span>
        </div>

        {goal ? (
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <span aria-hidden className="shrink-0 font-mono text-info">
              ◎
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" data-telemetry-mask>
              {goal.objective}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <QuietChip>
                <RefreshCw className="size-3" aria-hidden />
                {goal.iterations ?? 0}
              </QuietChip>
              {goal.tokensUsed != null ? (
                <QuietChip>{`${Math.round(goal.tokensUsed / 1000)}k tok`}</QuietChip>
              ) : null}
            </span>
          </div>
        ) : null}

        {view.sessionLink && onOpenSession ? (
          <button
            type="button"
            onClick={() => onOpenSession(view.sessionLink!)}
            className="mt-1 inline-flex items-center gap-1 text-xs text-faint transition-colors hover:text-info"
          >
            Open session
            <ArrowUpRight className="size-3" aria-hidden />
          </button>
        ) : null}
        {approvalControls ? <div className="mt-2">{approvalControls}</div> : null}
      </div>
    </div>
  );
}
