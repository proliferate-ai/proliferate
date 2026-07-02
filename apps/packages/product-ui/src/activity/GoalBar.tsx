import { useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Pause, Pencil, Play, Target, Trash2, X } from "lucide-react";
import {
  deriveGoalBarState,
  goalStatusLabel,
  type GoalCapabilities,
  type GoalWire,
} from "@proliferate/product-domain/activity/goal";
import { Button } from "@proliferate/ui/primitives/Button";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { GoalBarObjectiveEditor } from "./GoalBarObjectiveEditor";

const PAUSE_UNSUPPORTED_TOOLTIP = "Not supported by this agent";
const SET_GOAL_PLACEHOLDER = "Describe the goal to pursue";

export interface GoalBarProps {
  /** The mirrored native goal; null when no goal exists. */
  goal: GoalWire | null;
  capabilities: GoalCapabilities;
  /** Empty-state create mode: renders the bar as an editor with no goal set. */
  composing?: boolean;
  /** Playground/dev: start in the in-place edit state. */
  defaultEditing?: boolean;
  /**
   * A mutation is in flight awaiting the native round-trip. The bar keeps
   * showing the last confirmed mirror state — never an optimistic one — and
   * holds its controls until the write lands.
   */
  pendingWrite?: boolean;
  /** Commit a new/edited objective (native set; also used from create mode). */
  onEdit: (objective: string) => void;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  /** Dismiss the sticky met/blocked/failed result. */
  onDismiss: () => void;
  /** Leave create mode without setting a goal. */
  onCancelCompose?: () => void;
}

/**
 * Slim goal bar docked directly above the composer surface. Ever-present
 * while goal state is live (`◎ Pursuing goal <objective>` + pause/edit/
 * delete), a sticky result on met/blocked/failed, hidden otherwise.
 * Display + controls only — mutations round-trip through the callbacks.
 */
export function GoalBar({
  goal,
  capabilities,
  composing = false,
  defaultEditing = false,
  pendingWrite = false,
  onEdit,
  onPause,
  onResume,
  onClear,
  onDismiss,
  onCancelCompose,
}: GoalBarProps) {
  const [editing, setEditing] = useState(defaultEditing);
  const state = deriveGoalBarState(goal);

  if (state.kind === "hidden" && !composing) {
    return null;
  }
  if (!capabilities.supported) {
    return null;
  }

  let content: ReactNode;
  if (state.kind === "hidden") {
    content = (
      <GoalBarObjectiveEditor
        initialValue=""
        placeholder={SET_GOAL_PLACEHOLDER}
        onCommit={onEdit}
        onCancel={() => onCancelCompose?.()}
      />
    );
  } else if (state.kind === "live" && editing) {
    content = (
      <GoalBarObjectiveEditor
        initialValue={state.goal.objective}
        placeholder={SET_GOAL_PLACEHOLDER}
        onCommit={(objective) => {
          setEditing(false);
          onEdit(objective);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  } else if (state.kind === "live") {
    const paused = state.phase === "paused";
    content = (
      <>
        <span className="shrink-0 text-ui font-medium text-foreground">
          {goalStatusLabel(state.goal.status)}
        </span>
        <span
          className={twMerge(
            "min-w-0 flex-1 truncate text-ui text-muted-foreground",
            paused && "text-faint",
          )}
          data-telemetry-mask
        >
          {state.goal.objective}
        </span>
        <span
          className={twMerge(
            "flex shrink-0 items-center gap-0.5",
            pendingWrite && "pointer-events-none opacity-55",
          )}
        >
          <GoalBarPauseAction
            paused={paused}
            pauseSupported={capabilities.pause}
            onPause={onPause}
            onResume={onResume}
          />
          <GoalBarIconAction
            label="Edit goal"
            icon={<Pencil className="size-3.5" />}
            onClick={() => setEditing(true)}
          />
          <GoalBarIconAction
            label="Delete goal"
            icon={<Trash2 className="size-3.5" />}
            destructive
            onClick={onClear}
          />
        </span>
      </>
    );
  } else {
    content = (
      <>
        <span className="shrink-0 text-ui font-medium text-foreground">
          {state.headline}
        </span>
        {state.detail && (
          <span className="min-w-0 flex-1 truncate text-ui text-muted-foreground" data-telemetry-mask>
            — {state.detail}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          <GoalBarIconAction
            label="Dismiss goal result"
            icon={<X className="size-3.5" />}
            onClick={onDismiss}
          />
        </span>
      </>
    );
  }

  return (
    <div
      data-session-goal-bar
      aria-label="Session goal"
      className="relative overflow-clip rounded-t-[13px] border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))]"
    >
      <div className="flex h-9 min-w-0 items-center gap-2 pl-3 pr-1.5">
        <GoalBarGlyph state={state} />
        {content}
      </div>
    </div>
  );
}

function GoalBarGlyph({ state }: { state: ReturnType<typeof deriveGoalBarState> }) {
  if (state.kind === "result") {
    if (state.outcome === "met") {
      return <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden />;
    }
    return (
      <CircleAlert
        className={twMerge(
          "size-3.5 shrink-0",
          state.outcome === "blocked" ? "text-warning" : "text-destructive",
        )}
        aria-hidden
      />
    );
  }
  return <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

function GoalBarPauseAction({
  paused,
  pauseSupported,
  onPause,
  onResume,
}: {
  paused: boolean;
  pauseSupported: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const label = paused ? "Resume goal" : "Pause goal";
  const action = (
    <GoalBarIconAction
      label={label}
      icon={paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      disabled={!pauseSupported}
      onClick={paused ? onResume : onPause}
    />
  );
  if (pauseSupported) {
    return action;
  }
  return <Tooltip content={PAUSE_UNSUPPORTED_TOOLTIP}>{action}</Tooltip>;
}

function GoalBarIconAction({
  label,
  icon,
  onClick,
  disabled = false,
  destructive = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={disabled ? undefined : label}
      className={twMerge(
        "h-6 w-6 text-muted-foreground hover:text-foreground",
        destructive && "hover:text-destructive",
      )}
    >
      {icon}
    </Button>
  );
}
