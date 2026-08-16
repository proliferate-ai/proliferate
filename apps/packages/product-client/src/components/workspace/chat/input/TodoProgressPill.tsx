import { useEffect, useReducer, useRef, type CSSProperties } from "react";
import type { PlanEntry } from "@anyharness/sdk";
import { motion } from "@proliferate/design/motion";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import { Spinner } from "#product/primitives/Spinner";
import { CheckCircleFilled, Circle } from "#product/primitives/icons/status";
import { usePrefersReducedMotion } from "#product/hooks/ui/motion/use-prefers-reduced-motion";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { useActiveTodoTracker } from "#product/hooks/chat/derived/use-active-todo-tracker";
import {
  hasTodoStepAdvanced,
  summarizeTodoProgress,
  type TodoProgressSummary,
} from "#product/domain/chats/composer/todo-progress-summary";
import {
  INITIAL_TODO_PILL_STATE,
  todoPillReducer,
} from "#product/domain/chats/composer/todo-progress-pill-state";

// Pill choreography timings, sourced from the shared design `motion.delay`
// tokens (the raw millisecond values live only there). The pure reducer stays
// design-free; this connected component owns the timers that consume them.
const TODO_PILL_STEP_FADE_START_MS = motion.delay.todoPillStepLingerMs;
const TODO_PILL_STEP_HIDE_MS = motion.delay.todoPillStepHideMs;
const TODO_PILL_HOVER_FADE_START_MS = motion.delay.todoPillHoverLingerMs;
const TODO_PILL_HOVER_HIDE_MS = motion.delay.todoPillHoverHideMs;

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
      className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full bg-popover px-3 py-[5px] text-ui-sm text-muted-foreground shadow-popover ring-[0.5px] ring-border hover:text-foreground"
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
 * above the pill while it is hover-pinned; carries its own hover handlers so
 * crossing the gap from the pill keeps the pin alive.
 */
export function TodoProgressChecklistCard({
  entries,
  onMouseEnter,
  onMouseLeave,
}: {
  entries: PlanEntry[];
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      data-todo-progress-card
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto max-h-64 w-fit max-w-[min(520px,calc(100%-1rem))] overflow-y-auto rounded-lg bg-popover px-1 py-2 shadow-popover ring-[0.5px] ring-border"
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

interface TodoPillSnapshot {
  summary: TodoProgressSummary;
  entries: PlanEntry[];
}

/**
 * The per-session pill engine: watches `useActiveTodoTracker()` for step
 * advances and drives `todoPillReducer` through show -> linger -> fade ->
 * hide, or pin/checklist on hover. Keyed by session (see `TodoProgressPill`
 * below), so cross-session tracker deltas can never read as an advance.
 *
 * An advance that lands while the pointer is on the pill/checklist does not
 * restart that cycle: the pinned checklist stays mounted and updates in
 * place. Hover owns dismissal until the pointer leaves.
 *
 * Rendering works off the last non-null tracker snapshot rather than the
 * live tracker: when a completed plan leaves the transcript the pill keeps
 * lingering through its scheduled fade instead of being yanked mid-linger.
 */
function SessionTodoProgressPill() {
  const tracker = useActiveTodoTracker();
  const reducedMotion = usePrefersReducedMotion();
  const [state, dispatch] = useReducer(todoPillReducer, INITIAL_TODO_PILL_STATE);
  const previousSummaryRef = useRef<TodoProgressSummary | null>(null);
  const snapshotRef = useRef<TodoPillSnapshot | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the pointer is actually on the pill/checklist right now. Distinct
  // from `state.pinned`, which deliberately survives mouse-leave through the
  // leave-grace window — the step-advance effect must only hold its fire for
  // a real hover, never for that grace period (holding fire there would leave
  // the pill pinned open with no timer left to dismiss it).
  const hoveredRef = useRef(false);

  const summary = tracker ? summarizeTodoProgress(tracker.entries) : null;
  if (tracker && summary) {
    snapshotRef.current = { summary, entries: tracker.entries };
  }

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
      // Tracker gone (plan finished or left the transcript): forget the
      // baseline so a future plan's first appearance shows no pill, but let
      // any in-flight linger/fade timers run out against the snapshot.
      previousSummaryRef.current = null;
      return;
    }

    const advanced = hasTodoStepAdvanced(previousSummaryRef.current, summary);
    previousSummaryRef.current = summary;
    if (!advanced) {
      return;
    }

    if (hoveredRef.current) {
      // The user is inspecting the pinned checklist. Re-running the
      // show -> fade cycle here would unpin it: the card vanishes from under
      // the pointer, remounts on the next pointer move (restarting the
      // in-progress spinner's rotation), and the pill fades away mid-hover.
      // Hold the pin instead — the checklist rows update in place, and
      // dismissal stays owned by mouse-leave.
      return;
    }

    clearTimers();
    dispatch({ type: "step_advanced" });
    fadeTimerRef.current = setTimeout(() => dispatch({ type: "fade_start" }), TODO_PILL_STEP_FADE_START_MS);
    hideTimerRef.current = setTimeout(() => dispatch({ type: "hide" }), TODO_PILL_STEP_HIDE_MS);
    // `summary` is a fresh object every render (derived from the live
    // transcript); only its values matter for the advance check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.completedCount, summary?.currentStepNumber, summary?.total]);

  // Unmount safety net: clears whatever timers — step-advance or
  // hover-driven — happen to be pending when the session/composer unmounts.
  useEffect(() => clearTimers, []);

  const snapshot = snapshotRef.current;
  if (!snapshot || !state.visible) {
    return null;
  }

  // Reduced motion: show/hide directly instead of riding the opacity fade —
  // once the fade phase starts, unmount immediately rather than sitting at
  // opacity:0 for the remainder of the linger window.
  if (reducedMotion && state.fading) {
    return null;
  }

  function handleMouseEnter() {
    hoveredRef.current = true;
    clearTimers();
    dispatch({ type: "hover_on" });
  }

  function handleMouseLeave() {
    hoveredRef.current = false;
    clearTimers();
    dispatch({ type: "hover_off" });
    fadeTimerRef.current = setTimeout(() => dispatch({ type: "fade_start" }), TODO_PILL_HOVER_FADE_START_MS);
    hideTimerRef.current = setTimeout(() => dispatch({ type: "hide" }), TODO_PILL_HOVER_HIDE_MS);
  }

  return (
    <div role="status" className="pointer-events-none flex w-full flex-col items-center gap-2">
      {state.pinned && (
        <TodoProgressChecklistCard
          entries={snapshot.entries}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      )}
      <TodoProgressPillView
        label={snapshot.summary.label}
        faded={!reducedMotion && state.fading}
        animateFade={!reducedMotion}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}

/**
 * Connected floating pill. Mount this once, absolutely positioned above the
 * composer dock (see `ChatComposerDock`'s `floatingSlot`). Keyed by the
 * active session so switching sessions resets the engine wholesale — a
 * different session's plan state must neither read as a step advance nor
 * inherit a lingering pill.
 */
export function TodoProgressPill() {
  const activeSessionId = useActiveSessionId();
  if (!activeSessionId) {
    return null;
  }
  return <SessionTodoProgressPill key={activeSessionId} />;
}
