import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  goalResultStats,
  goalResultWhyLabel,
  type GoalBarState,
} from "@proliferate/product-domain/activity/goal";

type GoalBarResultState = Extract<GoalBarState, { kind: "result" }>;

export interface GoalBarResultPopoverProps {
  state: GoalBarResultState;
  onDismiss: () => void;
  /** Omitted when the bar has no way to reopen the compose editor. */
  onSetNewGoal?: () => void;
}

/**
 * Content for the goal bar's sticky-result expand popover
 * (session-activity-architecture §Locked decisions #5, revised after live
 * feedback 2026-07-03): the full objective, the full met/blocked/failed
 * reason as readable multi-line text (never truncated raw tool output —
 * that's the bug this redesign fixes), and a compact usage stats row when
 * the harness reported any. Chrome (surface, anchor, escape/outside-click
 * dismissal) is owned by the caller's popover primitive — this is content
 * only, same split as `LoopsPanel`/`AgentsRosterPanel`.
 */
export function GoalBarResultPopover({ state, onDismiss, onSetNewGoal }: GoalBarResultPopoverProps) {
  const stats = goalResultStats(state.goal);
  return (
    <div className="w-[min(22rem,calc(100vw-1rem))]" data-goal-bar-result-popover>
      <div className="px-3 pb-1.5 pt-2.5 text-ui font-medium text-foreground">
        {state.headline}
      </div>
      <div className="max-h-[min(60vh,22rem)] overflow-y-auto px-3 pb-2">
        <GoalBarResultSection label="Goal">
          <p className="whitespace-pre-wrap text-ui text-foreground" data-telemetry-mask>
            {state.goal.objective}
          </p>
        </GoalBarResultSection>
        {state.detail && (
          <GoalBarResultSection label={goalResultWhyLabel(state.outcome)} className="mt-2.5">
            <p className="whitespace-pre-wrap text-ui text-muted-foreground" data-telemetry-mask>
              {state.detail}
            </p>
          </GoalBarResultSection>
        )}
        {stats.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui-sm text-muted-foreground">
            {stats.map((stat, index) => (
              <span key={stat.key} className="flex items-center gap-1.5">
                {index > 0 && <span aria-hidden className="text-faint">·</span>}
                <span>{stat.text}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-1.5 border-t border-border px-2 py-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
        {onSetNewGoal && (
          <Button type="button" variant="secondary" size="sm" onClick={onSetNewGoal}>
            <Pencil className="size-3.5" />
            Set new goal
          </Button>
        )}
      </div>
    </div>
  );
}

function GoalBarResultSection({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-ui-sm font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
