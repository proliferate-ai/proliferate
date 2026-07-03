import type { ReactNode } from "react";
import {
  stepRunStatusLabel,
  type WorkflowStepOutputChip,
  type WorkflowStepRunView,
  type WorkflowStepSessionLink,
} from "@proliferate/product-domain/workflows/run-status";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { ArrowUpRight, ExternalLink } from "@proliferate/ui/icons";
import { WorkflowStepKindBadge } from "./WorkflowStepKindBadge";
import { WorkflowStepRunDot } from "./WorkflowStepRunDot";

function OutputChip({ chip }: { chip: WorkflowStepOutputChip }) {
  const base = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs";
  switch (chip.kind) {
    case "exit":
      return (
        <span
          className={twMerge(
            base,
            chip.ok
              ? "border-success/25 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {chip.label}
        </span>
      );
    case "pr":
      return chip.href ? (
        <a
          href={chip.href}
          target="_blank"
          rel="noreferrer"
          className={twMerge(base, "border-info/25 bg-info/10 text-info hover:underline")}
        >
          {chip.label}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : (
        <span className={twMerge(base, "border-info/25 bg-info/10 text-info")}>{chip.label}</span>
      );
    case "notify":
      return (
        <span
          className={twMerge(
            base,
            chip.delivered ? "border-border bg-accent text-muted-foreground" : "border-border text-faint",
          )}
        >
          {chip.label}
        </span>
      );
    case "approval":
      return (
        <span
          className={twMerge(
            base,
            chip.approved
              ? "border-success/25 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {chip.label}
        </span>
      );
    case "text":
      return <span className={twMerge(base, "border-border bg-accent text-muted-foreground")}>{chip.label}</span>;
  }
}

export interface WorkflowRunTimelineRowProps {
  view: WorkflowStepRunView;
  durationLabel?: string | null;
  /** Deep-link into the workspace/session view for an agent step (spec 3.6). */
  onOpenSession?: (link: WorkflowStepSessionLink) => void;
  /** Inline approve/deny controls for a waiting_approval step. */
  approvalControls?: ReactNode;
  /** Draw the connector line down to the next row. */
  connector?: boolean;
  className?: string;
}

/** One step row in the run view timeline (spec 3.6). Presentational. */
export function WorkflowRunTimelineRow({
  view,
  durationLabel,
  onOpenSession,
  approvalControls,
  connector = false,
  className = "",
}: WorkflowRunTimelineRowProps) {
  const goal = view.goalLine;
  return (
    <div className={twMerge("flex gap-3", className)}>
      <div className="flex flex-col items-center pt-1.5">
        <WorkflowStepRunDot kind={view.dotKind} />
        {connector ? <span className="mt-1 w-px flex-1 bg-border" aria-hidden /> : null}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <WorkflowStepKindBadge kind={view.kind} />
          <span className="text-sm text-muted-foreground">{stepRunStatusLabel(view.status)}</span>
          {durationLabel ? (
            <span className="text-xs tabular-nums text-faint">· {durationLabel}</span>
          ) : null}
          {view.chips.map((chip, index) => (
            <OutputChip key={index} chip={chip} />
          ))}
        </div>
        {goal ? (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span aria-hidden className="font-mono text-info">
              ◎
            </span>
            <span className="min-w-0 truncate" data-telemetry-mask>
              {goal.objective}
            </span>
            <span className="text-xs text-faint">
              {[
                goal.status,
                goal.iterations != null ? `${goal.iterations} iterations` : null,
                goal.tokensUsed != null ? `${goal.tokensUsed.toLocaleString()} tokens` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ) : null}
        {view.sessionLink && onOpenSession ? (
          <button
            type="button"
            onClick={() => onOpenSession(view.sessionLink!)}
            className="mt-1.5 inline-flex items-center gap-1 text-sm text-info hover:underline"
          >
            Open session
            <ArrowUpRight className="size-3.5" aria-hidden />
          </button>
        ) : null}
        {approvalControls ? <div className="mt-2">{approvalControls}</div> : null}
      </div>
    </div>
  );
}
