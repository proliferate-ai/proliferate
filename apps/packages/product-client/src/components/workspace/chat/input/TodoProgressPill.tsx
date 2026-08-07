import { useEffect, useReducer, useRef, type CSSProperties } from "react";
import type { PlanEntry } from "@anyharness/sdk";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import { Spinner } from "#product/primitives/Spinner";
import { CheckCircleFilled, Circle } from "#product/primitives/icons/status";
import { usePrefersReducedMotion } from "#product/hooks/ui/motion/use-prefers-reduced-motion";
import { useActiveTodoTracker } from "#product/hooks/chat/derived/use-active-todo-tracker";
import {
  hasTodoStepAdvanced,
  summarizeTodoProgress,
} from "#product/domain/chats/composer/todo-progress-summary";
import {
  INITIAL_TODO_PILL_STATE,
  TODO_PILL_HOVER_FADE_START_MS,
  TODO_PILL_HOVER_HIDE_MS,
  TODO_PILL_STEP_FADE_START_MS,
  TODO_PILL_STEP_HIDE_MS,
  todoPillReducer,
} from "#product/domain/chats/composer/todo-progress-pill-state";

const DOT_CELL_STYLE = {
  "--dot-cell-size": "0.125rem",
  "--dot-cell-gap": "0.078rem",
} as CSSProperties;

/**
 * Pure pill chrome — the floating "Step N/Total" affordance. No timers, no
 * hover wiring: `faded` and the mouse handlers are fully controlled, so this
 * is fixture-able from the playground.
 */
export function TodoProgressPillView({
  label,
  faded,
  animateFade,
  onMouseEnter,
  onMouseLeave,
}: {
  label: string;
  faded: boolean;
  /** Skip the opacity transition under `prefers-reduced-motion`. */
  animateFade: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      data-todo-progress-pill
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto flex cursor-default items-center gap-1.5 rounded-full bg-popover px-3 py-[5px] text-ui-sm text-muted-foreground shadow-popover ring-[0.5px] ring-border hover:text-foreground"
      style={{
        opacity: faded ? 0 : 1,
        transition: animateFade ? "opacity var(--duration-dissolve) var(--ease-standard)" : "none",
      }}
    >
      <DotCellLoader aria-hidden="true" size="compact" variant="wave" style={DOT_CELL_STYLE} />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}

const CHECKLIST_STATUS_TEXT_CLASSNAME: Record<string, string> = {
  in_progress: "text-foreground",
  completed: "text-muted-foreground/60 line-through",
};

function ChecklistStatusIcon({ status }: { status: string }) {
  if (status === "in_progress") {
    return <Spinner className="icon-paired shrink-0 text-special" />;
  }
  if (status === "completed") {
    return <CheckCircleFilled className="icon-paired shrink-0 text-muted-foreground" />;
  }
  return <Circle className="icon-paired shrink-0 text-faint" />;
}

/**
 * Pure hover checklist — every entry in the plan, one row each. Rendered
 * above the pill only while it is hovered/pinned.
 */
export function TodoProgressChecklistCard({ entries }: { entries: PlanEntry[] }) {
  return (
    <div
      data-todo-progress-card
      className="pointer-events-auto w-fit max-w-[520px] rounded-lg bg-popover px-1 py-2 shadow-popover ring-[0.5px] ring-border"
    >
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 px-3 py-1 text-ui">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <ChecklistStatusIcon status={entry.status} />
          </span>
          <span className={`min-w-0 ${CHECKLIST_STATUS_TEXT_CLASSNAME[entry.status] ?? "text-muted-foreground"}`}>
            {entry.content}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Connected floating pill: watches `useActiveTodoTracker()` for step
 * advances and drives `todoPillReducer` through show -> linger -> fade ->
 * hide, or pin/checklist on hover. Mount this once, absolutely positioned
 * above the composer dock (see `ChatComposerDock`'s `floatingSlot`).
 */
export function TodoProgressPill() {
  const tracker = useActiveTodoTracker();
  const reducedMotion = usePrefersReducedMotion();
  const [state, dispatch] = useReducer(todoPillReducer, INITIAL_TODO_PILL_STATE);
  const previousSummaryRef = useRef<ReturnType<typeof summarizeTodoProgress>>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summary = tracker ? summarizeTodoProgress(tracker.entries) : null;

  // Shared by the step-advance effect below and the hover handlers further
  // down: every new "reason to show/fade the pill" starts by clearing
  // whatever fade/hide timers a previous reason left pending.
  function clearTimers() {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (!summary) {
      previousSummaryRef.current = null;
      clearTimers();
      dispatch({ type: "tracker_cleared" });
      return;
    }

    const advanced = hasTodoStepAdvanced(previousSummaryRef.current, summary);
    previousSummaryRef.current = summary;
    if (!advanced) {
      return;
    }

    clearTimers();
    dispatch({ type: "step_advanced" });
    fadeTimerRef.current = setTimeout(() => dispatch({ type: "fade_start" }), TODO_PILL_STEP_FADE_START_MS);
    hideTimerRef.current = setTimeout(() => dispatch({ type: "hide" }), TODO_PILL_STEP_HIDE_MS);
    // `summary` is a fresh object every render (derived from the live
    // transcript); only its values matter for the advance check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.currentStepNumber, summary?.total]);

  // Unmount safety net: clears whatever timers — step-advance or
  // hover-driven — happen to be pending when the composer/session unmounts.
  useEffect(() => clearTimers, []);

  if (!tracker || !summary || !state.visible) {
    return null;
  }

  // Reduced motion: show/hide directly instead of riding the opacity fade —
  // once the fade phase starts, unmount immediately rather than sitting at
  // opacity:0 for the remainder of the linger window.
  if (reducedMotion && state.fading) {
    return null;
  }

  function handleMouseEnter() {
    clearTimers();
    dispatch({ type: "hover_on" });
  }

  function handleMouseLeave() {
    clearTimers();
    dispatch({ type: "hover_off" });
    fadeTimerRef.current = setTimeout(() => dispatch({ type: "fade_start" }), TODO_PILL_HOVER_FADE_START_MS);
    hideTimerRef.current = setTimeout(() => dispatch({ type: "hide" }), TODO_PILL_HOVER_HIDE_MS);
  }

  return (
    <div className="pointer-events-none flex flex-col items-center gap-2">
      {state.pinned && <TodoProgressChecklistCard entries={tracker.entries} />}
      <TodoProgressPillView
        label={summary.label}
        faded={!reducedMotion && state.fading}
        animateFade={!reducedMotion}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
