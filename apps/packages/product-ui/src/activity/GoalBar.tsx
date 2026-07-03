import { useState, type ReactNode } from "react";
import {
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Pause,
  Pencil,
  Play,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  deriveGoalBarState,
  goalStatusLabel,
  type GoalCapabilities,
  type GoalWire,
} from "@proliferate/product-domain/activity/goal";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { ComposerPopoverSurface } from "../chat/composer/ComposerPopoverSurface";
import { GoalBarIconAction } from "./GoalBarIconAction";
import { GoalBarObjectiveEditor } from "./GoalBarObjectiveEditor";
import { GoalBarResultPopover } from "./GoalBarResultPopover";

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
  /**
   * The sticky result popover's "Set new goal" footer action: opens the
   * bar's compose/edit state over the result (same blank editor as the
   * empty-state "set a goal" affordance). Omitted hides that action.
   */
  onSetNewGoal?: () => void;
  /** Playground/dev: start the sticky result's expand popover already open. */
  defaultResultExpanded?: boolean;
  /**
   * Compact activity chips (`⟳ loops · ▸ terminals · ⑂ agents`) that stack on
   * the same bar row (session-activity-architecture §Locked decisions #5).
   * When there is no live goal state and the bar isn't composing, the chips
   * alone still render the bar — activity can be live with no goal set.
   */
  chips?: ReactNode;
}

/**
 * Slim goal bar docked directly above the composer surface. Ever-present
 * while goal state is live (`◎ Pursuing goal <objective>` + pause/edit/
 * delete), a sticky result on met/blocked/failed, hidden otherwise. The
 * sticky result's collapsed line shows the OBJECTIVE (never the raw met/
 * blocked reason — evaluator reasons quote tool output and truncate
 * uselessly) and expands to a popover with the full objective, full reason,
 * and usage stats (live feedback 2026-07-03; session-activity-architecture
 * §Locked decisions #5). Display + controls only — mutations round-trip
 * through the callbacks.
 */
export function GoalBar({
  goal,
  capabilities,
  composing = false,
  defaultEditing = false,
  defaultResultExpanded = false,
  pendingWrite = false,
  onEdit,
  onPause,
  onResume,
  onClear,
  onDismiss,
  onCancelCompose,
  onSetNewGoal,
  chips,
}: GoalBarProps) {
  const [editing, setEditing] = useState(defaultEditing);
  // Forces the result popover open on mount (playground/dev only); cleared
  // the moment it's genuinely closed so it behaves like ordinary
  // click-to-toggle state afterward — same "seed, then free" shape as
  // `defaultEditing`.
  const [resultForceOpen, setResultForceOpen] = useState(defaultResultExpanded);
  const state = deriveGoalBarState(goal);

  // Goal content only renders when the capability supports it AND there is
  // live/composing goal state — activity chips can be live with no goal set
  // at all, so the bar must not hide (or force the goal layout) in that case.
  const goalVisible = capabilities.supported && (state.kind !== "hidden" || composing);

  if (!goalVisible && !chips) {
    return null;
  }

  // Editing/composing swaps the fixed single-row layout for a tall,
  // auto-growing textarea (Conductor reference): the glyph aligns with the
  // textarea's first line instead of a fixed-height row.
  const isEditingLayout = goalVisible && (composing || (state.kind === "live" && editing));
  // Chips are suppressed while the multi-line editor is showing — its
  // absolute-positioned commit/cancel icons already crowd that row.
  const showChips = Boolean(chips) && !isEditingLayout;

  let content: ReactNode = null;
  if (!goalVisible) {
    // Chips-only bar: no goal capability, or no live/composing goal state.
  } else if (composing && state.kind !== "live") {
    // The empty-state "set a goal" affordance AND the sticky result's
    // "Set new goal" popover action both land here — same blank editor
    // either way. (Composing never overrides an already-live goal — the
    // composer's "Set a goal" row is only offered when nothing is live.)
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
  } else if (state.kind === "result") {
    // Sticky met/blocked/failed outcome. The whole non-button area of the
    // row (glyph, headline, objective) is the expand trigger — only the
    // dismiss (×) button sits outside it. Esc/click-outside close the
    // popover via the underlying Radix primitive.
    content = (
      <>
        <PopoverButton
          trigger={(
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left"
              aria-label={`${state.headline} — show details`}
            >
              <GoalBarGlyph state={state} />
              <span className="shrink-0 text-ui font-medium text-foreground">
                {state.headline}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-ui text-muted-foreground"
                data-telemetry-mask
              >
                — {state.goal.objective}
              </span>
              <ChevronUp className="size-3.5 shrink-0 text-faint" aria-hidden />
            </button>
          )}
          side="top"
          align="start"
          offset={8}
          externalOpen={resultForceOpen ? true : undefined}
          onOpenChange={(open) => {
            if (!open) {
              setResultForceOpen(false);
            }
          }}
          className="w-auto border-0 bg-transparent p-0 shadow-none"
        >
          {(close) => (
            <ComposerPopoverSurface className="p-0" data-telemetry-mask>
              <GoalBarResultPopover
                state={state}
                onDismiss={() => {
                  onDismiss();
                  close();
                }}
                onSetNewGoal={onSetNewGoal ? () => {
                  onSetNewGoal();
                  close();
                } : undefined}
              />
            </ComposerPopoverSurface>
          )}
        </PopoverButton>
        <span className="ml-1 flex shrink-0 items-center">
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
      <div
        className={twMerge(
          "flex min-w-0 gap-2 pl-3 pr-1.5",
          isEditingLayout ? "items-start py-1.5" : "h-9 items-center",
        )}
      >
        {/* The result row renders its own glyph inside the expand trigger
            button so the whole row (glyph included) is clickable. */}
        {goalVisible && state.kind !== "result" && (
          <GoalBarGlyph state={state} raised={isEditingLayout} />
        )}
        {content}
        {showChips && (
          <span className={twMerge("flex shrink-0 items-center", goalVisible && "ml-1")}>
            {chips}
          </span>
        )}
      </div>
    </div>
  );
}

function GoalBarGlyph({
  state,
  raised = false,
}: {
  state: ReturnType<typeof deriveGoalBarState>;
  /** Nudged down to align with a multi-line editor's first line of text. */
  raised?: boolean;
}) {
  const className = twMerge("size-3.5 shrink-0", raised && "mt-1");
  if (state.kind === "result") {
    if (state.outcome === "met") {
      return <CircleCheck className={twMerge(className, "text-success")} aria-hidden />;
    }
    return (
      <CircleAlert
        className={twMerge(className, state.outcome === "blocked" ? "text-warning" : "text-destructive")}
        aria-hidden
      />
    );
  }
  return <Target className={twMerge(className, "text-muted-foreground")} aria-hidden />;
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
  const icon = paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />;
  if (pauseSupported) {
    return (
      <GoalBarIconAction label={label} icon={icon} onClick={paused ? onResume : onPause} />
    );
  }
  // Pause is unsupported for this agent. Keep the control focusable
  // (aria-disabled, not the native `disabled` attribute that drops it from the
  // tab order) so keyboard and screen-reader users can reach the tooltip that
  // explains why, and fold the reason into the accessible name for AT.
  return (
    <Tooltip content={PAUSE_UNSUPPORTED_TOOLTIP}>
      <GoalBarIconAction label={`${label} — ${PAUSE_UNSUPPORTED_TOOLTIP}`} icon={icon} inert />
    </Tooltip>
  );
}
