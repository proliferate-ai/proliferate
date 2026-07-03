import type { ReactNode } from "react";
import type { WorkflowOnFail, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import {
  goalRailLine,
  stepStripGlyph,
  workflowStepPreview,
} from "@proliferate/product-domain/workflows/presentation";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { WorkflowStepKindBadge } from "./WorkflowStepKindBadge";

function onFailLabel(onFail: WorkflowOnFail): string {
  switch (onFail.kind) {
    case "stop":
      return "On fail: stop";
    case "continue":
      return "On fail: continue";
    case "retry":
      return `On fail: retry ×${onFail.n ?? 1}`;
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
  /** Footer control; defaults to the on-fail label text. */
  footer?: ReactNode;
  className?: string;
}

/**
 * A single program step card (spec 3.6): kind badge, content preview, the
 * goal two-line treatment when armed, and an on-fail footer. Purely
 * presentational — selection and editing are driven by callbacks.
 */
export function WorkflowStepCard({
  step,
  index,
  selected = false,
  invalid = false,
  onSelect,
  dragHandle,
  menu,
  footer,
  className = "",
}: WorkflowStepCardProps) {
  const goalLine = goalRailLine(step);
  const preview = workflowStepPreview(step);

  return (
    <div
      className={twMerge(
        "group relative rounded-[10px] border bg-background transition-colors",
        selected ? "border-accent-foreground/40 ring-1 ring-accent-foreground/20" : "border-border",
        invalid ? "border-destructive/60" : "",
        onSelect ? "cursor-pointer hover:border-foreground/25" : "",
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
      <div className="flex items-start gap-2 px-3 pt-2.5">
        {dragHandle ? <span className="mt-0.5 shrink-0 text-faint">{dragHandle}</span> : null}
        <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-xs tabular-nums text-faint">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <WorkflowStepKindBadge kind={step.kind} glyph={stepStripGlyph(step)} />
            {menu ? <span className="shrink-0">{menu}</span> : null}
          </div>
          <p className="mt-1 truncate text-ui-sm text-muted-foreground" data-telemetry-mask>
            {preview}
          </p>
          {goalLine ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-ui-sm text-muted-foreground">
              <span aria-hidden className="font-mono text-info">
                {goalLine.glyph}
              </span>
              <span className="truncate" data-telemetry-mask>
                {goalLine.text}
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5">
        {footer ?? <span className="text-xs text-faint">{onFailLabel(step.onFail)}</span>}
        {invalid ? <span className="text-xs text-destructive">Needs attention</span> : null}
      </div>
    </div>
  );
}
