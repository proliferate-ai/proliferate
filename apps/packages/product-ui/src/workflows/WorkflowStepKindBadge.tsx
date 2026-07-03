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

interface KindVisual {
  Icon: ComponentType<IconProps>;
  /** Pill tint — subtle surface + colored ink, per kind. */
  tint: string;
}

/**
 * Per-kind pill visuals (Ona parity): each step kind gets a tinted pill with a
 * matching icon from the app's icon set. Tints use design tokens only.
 */
const KIND_VISUAL: Record<WorkflowStepKind, KindVisual> = {
  "agent.prompt": { Icon: MessageSquare, tint: "bg-highlight text-info" },
  "shell.run": { Icon: SquareTerminal, tint: "bg-warning text-warning-foreground" },
  "scm.open_pr": { Icon: GitPullRequest, tint: "bg-pr-merged/15 text-pr-merged" },
  notify: { Icon: SendIcon, tint: "bg-positive-muted text-positive" },
  "human.approval": {
    Icon: Pause,
    tint: "bg-surface-elevated-secondary text-muted-foreground ring-1 ring-inset ring-border",
  },
};

export interface WorkflowStepKindBadgeProps {
  kind: WorkflowStepKind;
  /** Show only the icon chip, hiding the text label. */
  iconOnly?: boolean;
  className?: string;
}

/** The step-kind pill: a tinted icon + label chip (spec 3.6, Ona parity). */
export function WorkflowStepKindBadge({
  kind,
  iconOnly = false,
  className = "",
}: WorkflowStepKindBadgeProps) {
  const meta = WORKFLOW_STEP_META[kind];
  const { Icon, tint } = KIND_VISUAL[kind];
  return (
    <span
      className={twMerge(
        "inline-flex select-none items-center gap-1.5 rounded-full px-2 py-0.5 text-sm font-medium leading-none",
        tint,
        iconOnly ? "px-1 py-1" : "",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {iconOnly ? null : <span>{meta.label}</span>}
    </span>
  );
}
