import type { ReactNode } from "react";
import type { WorkflowOnFail, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import {
  goalRailLine,
  WORKFLOW_STEP_META,
  workflowStepExcerpt,
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
  /** Kebab / overflow menu rendered at the top-right. */
  menu?: ReactNode;
  /**
   * Interactive on-fail control (rail cards). When omitted, a static chip is
   * shown only for non-default policies.
   */
  onFailControl?: ReactNode;
  /** Draw the connector spine down to the next card. */
  connector?: boolean;
  /**
   * Scope annotation for agent.config steps. When provided, overrides the
   * static caption with session-aware copy:
   * - `isNewSession: true` → "opens a new session"
   * - `isNewSession: false` → "continues session · model → X"
   */
  scopeAnnotation?: {
    isNewSession: boolean;
    effectiveHarness: string;
    effectiveModel: string;
  } | null;
  /**
   * Scope label shown at the start of a scope group on the spine (e.g. "claude · sonnet").
   * Rendered as a quiet annotation above the card.
   */
  scopeLabel?: string | null;
  className?: string;
}

/** The numbered gutter circle on the connector spine (Family-2 F). */
function SpineNumber({ n, connector }: { n: number; connector: boolean }) {
  return (
    <div className="flex shrink-0 flex-col items-center">
      <span className="flex size-6 items-center justify-center rounded-full border border-border bg-surface-elevated-secondary font-mono text-xs leading-none tabular-nums text-muted-foreground">
        {n}
      </span>
      {connector ? <span className="mt-1.5 w-px flex-1 bg-border" aria-hidden /> : null}
    </div>
  );
}

/**
 * A single program step card (spec 3.6, "Family-2 F"): a numbered spine for
 * chain orientation + a roomy, un-nested card. The kind pill and quiet
 * affordances sit on one line, the content excerpt renders as clean regular
 * text (never mono — mono lives only in the panel's command editor), and an
 * armed goal gets a hairline footer. Purely presentational.
 */
export function WorkflowStepCard({
  step,
  index,
  selected = false,
  invalid = false,
  onSelect,
  menu,
  onFailControl,
  connector = false,
  scopeAnnotation,
  scopeLabel,
  className = "",
}: WorkflowStepCardProps) {
  const goalLine = goalRailLine(step);
  const excerpt = workflowStepExcerpt(step);
  const hasContent = excerpt.trim() !== "";
  const isAgentConfig = step.kind === "agent.config";
  const onFailChip = shortOnFailLabel(step.onFail);

  return (
    <div className="flex flex-col">
      {scopeLabel ? (
        <div className="mb-1.5 flex items-center gap-2 pl-9">
          <span className="font-mono text-[10px] leading-tight text-muted-foreground/70">
            {scopeLabel}
          </span>
        </div>
      ) : null}
      <div className="flex gap-3.5">
      <SpineNumber n={index + 1} connector={connector} />
      <div className={twMerge("min-w-0 flex-1", connector ? "pb-4" : "")}>
        <div
          className={twMerge(
            "group rounded-xl border p-4 shadow-sm transition-colors",
            isAgentConfig ? "bg-surface-elevated-secondary/40" : "bg-background",
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
          <div className="flex items-center gap-2.5">
            <WorkflowStepKindBadge kind={step.kind} />
            {onFailControl
              ?? (onFailChip ? <span className="text-xs text-faint">{onFailChip}</span> : null)}
            <span className="flex-1" />
            {menu ? <span className="shrink-0">{menu}</span> : null}
          </div>

          {hasContent ? (
            <p
              className="mt-3 line-clamp-2 break-words text-sm leading-relaxed text-foreground"
              data-telemetry-mask
            >
              {excerpt}
            </p>
          ) : (
            <p className="mt-3 text-sm text-faint">{WORKFLOW_STEP_META[step.kind].hint}</p>
          )}

          {isAgentConfig ? (
            <p className="mt-2.5 text-xs leading-snug text-faint">
              {scopeAnnotation
                ? scopeAnnotation.isNewSession
                  ? `opens a new session · ${scopeAnnotation.effectiveHarness}`
                  : `continues session · model → ${scopeAnnotation.effectiveModel}`
                : "Sets the agent for the steps below · switching harness opens a new session"}
            </p>
          ) : null}

          {goalLine ? (
            <p className="mt-3 flex min-w-0 items-center gap-1.5 border-t border-border pt-2.5 text-sm text-muted-foreground">
              <span aria-hidden className="shrink-0 font-mono text-info">
                {goalLine.glyph}
              </span>
              <span className="truncate" data-telemetry-mask>
                {goalLine.text}
              </span>
            </p>
          ) : null}

          {invalid ? <span className="mt-2 block text-xs text-destructive">Needs attention</span> : null}
        </div>
      </div>
    </div>
    </div>
  );
}
