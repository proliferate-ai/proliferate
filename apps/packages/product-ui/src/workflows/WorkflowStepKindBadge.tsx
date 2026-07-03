import type { ComponentType } from "react";
import type { WorkflowStepKind } from "@proliferate/product-domain/workflows/definition";
import { WORKFLOW_STEP_META } from "@proliferate/product-domain/workflows/presentation";
import type { IconProps } from "@proliferate/ui/icons";
import {
  GitPullRequest,
  MessageSquare,
  Pause,
  SendIcon,
  SquareTerminal,
} from "@proliferate/ui/icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

/**
 * Per-kind icons from the app icon set. The pill itself is deliberately
 * monochrome — one quiet neutral treatment for every kind — so the icon
 * shape, not a color, differentiates kinds on the mono-dark surface.
 */
const KIND_ICON: Record<WorkflowStepKind, ComponentType<IconProps>> = {
  "agent.prompt": MessageSquare,
  "shell.run": SquareTerminal,
  "scm.open_pr": GitPullRequest,
  notify: SendIcon,
  "human.approval": Pause,
};

const PILL_TREATMENT =
  "bg-surface-elevated-secondary text-foreground ring-1 ring-inset ring-border";

export interface WorkflowStepKindBadgeProps {
  kind: WorkflowStepKind;
  /** Show only the icon chip, hiding the text label. */
  iconOnly?: boolean;
  className?: string;
}

/** The step-kind pill: a quiet mono icon + label chip (spec 3.6). */
export function WorkflowStepKindBadge({
  kind,
  iconOnly = false,
  className = "",
}: WorkflowStepKindBadgeProps) {
  const meta = WORKFLOW_STEP_META[kind];
  const Icon = KIND_ICON[kind];
  return (
    <span
      className={twMerge(
        "inline-flex select-none items-center gap-1.5 rounded-full px-2 py-0.5 text-sm font-medium leading-none",
        PILL_TREATMENT,
        iconOnly ? "px-1 py-1" : "",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {iconOnly ? null : <span>{meta.label}</span>}
    </span>
  );
}
