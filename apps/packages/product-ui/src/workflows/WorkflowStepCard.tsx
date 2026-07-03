import type { ReactNode } from "react";
import type { WorkflowOnFail, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import {
  goalRailLine,
  WORKFLOW_STEP_META,
  workflowStepPreview,
} from "@proliferate/product-domain/workflows/presentation";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { WorkflowStepKindBadge } from "./WorkflowStepKindBadge";

/** Compact on-fail label for the quiet card chip. `stop` is the default → hidden. */
export function shortOnFailLabel(onFail: WorkflowOnFail): string | null {
  switch (onFail.kind) {
    case "stop":
      return null;
    case "continue":
      return "Continue on fail";
    case "retry":
      return `Retry ×${onFail.n ?? 1} on fail`;
  }
}

export interface WorkflowStepCardProps {
  step: WorkflowStep;
  index: number;
  selected?: boolean;
  invalid?: boolean;
  onSelect?: () => void;
  /** Drag affordance rendered at the card's left edge. */
  dragHandle?: ReactNode;
  /** Kebab / overflow menu rendered at the top-right. */
  menu?: ReactNode;
  /**
   * Interactive on-fail control (rail cards). When omitted, a static chip is
   * shown only for non-default policies.
   */
  onFailControl?: ReactNode;
  className?: string;
}

/**
 * A single program step card (spec 3.6, Ona parity): a tinted kind pill with an
 * icon, a bordered content preview that collapses when the step has no content
 * yet, and the goal two-line treatment when armed. On-fail is a quiet chip
 * (non-default only), not a detached footer. Purely presentational.
 */
export function WorkflowStepCard({
  step,
  index,
  selected = false,
  invalid = false,
  onSelect,
  dragHandle,
  menu,
  onFailControl,
  className = "",
}: WorkflowStepCardProps) {
  const goalLine = goalRailLine(step);
  const preview = workflowStepPreview(step);
  const hasContent = preview !== WORKFLOW_STEP_META[step.kind].hint;
  const mono = step.kind === "shell.run";
  const onFailChip = shortOnFailLabel(step.onFail);

  return (
    <div
      className={twMerge(
        "group relative flex gap-2.5 rounded-xl border bg-background p-3 shadow-sm transition-colors",
        selected
          ? "border-border-heavy ring-1 ring-border-heavy"
          : "border-border hover:border-border-heavy",
        invalid ? "border-destructive/60 hover:border-destructive/60" : "",
        onSelect ? "cursor-pointer" : "",
        className,
      )}
      data-selected={selected}
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      <div className="flex w-4 shrink-0 flex-col items-center gap-1 pt-0.5">
        {dragHandle ? (
          <span className="text-faint transition-colors group-hover:text-muted-foreground">
            {dragHandle}
          </span>
        ) : null}
        <span className="font-mono text-[10px] leading-none tabular-nums text-faint">
          {index + 1}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <WorkflowStepKindBadge kind={step.kind} />
          <div className="flex shrink-0 items-center gap-1">
            {onFailControl
              ?? (onFailChip ? (
                <span className="rounded-full bg-surface-elevated-secondary px-2 py-0.5 text-xs text-faint">
                  {onFailChip}
                </span>
              ) : null)}
            {menu ? <span className="shrink-0">{menu}</span> : null}
          </div>
        </div>

        {hasContent ? (
          <div className="rounded-lg border border-border bg-surface-elevated-secondary/60 px-2.5 py-1.5">
            <p
              className={twMerge(
                "line-clamp-2 break-words text-ui-sm text-muted-foreground",
                mono ? "font-mono text-xs" : "",
              )}
              data-telemetry-mask
            >
              {preview}
            </p>
          </div>
        ) : (
          <p className="text-ui-sm text-faint">{WORKFLOW_STEP_META[step.kind].hint}</p>
        )}

        {goalLine ? (
          <p className="flex min-w-0 items-center gap-1.5 truncate text-ui-sm text-muted-foreground">
            <span aria-hidden className="font-mono text-info">
              {goalLine.glyph}
            </span>
            <span className="truncate" data-telemetry-mask>
              {goalLine.text}
            </span>
          </p>
        ) : null}

        {invalid ? <span className="text-xs text-destructive">Needs attention</span> : null}
      </div>
    </div>
  );
}
