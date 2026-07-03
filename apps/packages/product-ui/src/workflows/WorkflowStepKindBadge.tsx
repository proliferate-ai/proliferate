import type { WorkflowStepKind } from "@proliferate/product-domain/workflows/definition";
import { WORKFLOW_STEP_META } from "@proliferate/product-domain/workflows/presentation";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

export interface WorkflowStepKindBadgeProps {
  kind: WorkflowStepKind;
  /** Override the glyph (e.g. the goal glyph `◎` for a goal-armed prompt). */
  glyph?: string;
  /** Hide the text label, showing only the glyph chip. */
  glyphOnly?: boolean;
  className?: string;
}

/** The step-kind chip: a mono glyph tile plus its label (spec 3.6). */
export function WorkflowStepKindBadge({
  kind,
  glyph,
  glyphOnly = false,
  className = "",
}: WorkflowStepKindBadgeProps) {
  const meta = WORKFLOW_STEP_META[kind];
  return (
    <span className={twMerge("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-[6px] border border-border bg-foreground/[0.04] font-mono text-xs leading-none text-muted-foreground"
      >
        {glyph ?? meta.glyph}
      </span>
      {glyphOnly ? null : (
        <span className="text-ui-sm font-medium text-foreground">{meta.label}</span>
      )}
    </span>
  );
}
