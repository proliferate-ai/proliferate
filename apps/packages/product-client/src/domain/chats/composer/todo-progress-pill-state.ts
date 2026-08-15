/**
 * Pure show -> linger -> fade -> hide state machine for the floating todo
 * progress pill (`TodoProgressPill.tsx`). Timers live in the connected
 * component; this module only knows the state transitions, so it can be
 * tested without React or fake timers touching the DOM.
 *
 * Timings straight from the design handoff
 * (`design_handoff_composer_dock/Todos.dc.html`, `_simulateStep`/`pillHoverOn`/
 * `pillHoverOff`), re-expressed as shared `motion.delay` tokens:
 *   - a step advancing shows the pill, fade starts at 3.4s, hidden by 4s
 *   - hovering pins the pill (cancels any fade) and reveals the checklist
 *   - mouse-leave restarts a short fade: starts at 1.2s, hidden by 1.8s
 *
 * A step advance while the pointer is actually on the pill/checklist never
 * reaches this reducer: the connected component holds its fire so the pinned
 * checklist stays mounted and updates in place (`step_advanced` would unpin
 * it out from under the pointer and remount its in-progress spinner).
 *
 * `pinned` intentionally survives `hover_off` and only drops when the
 * leave-fade actually starts: the checklist card renders while pinned, and
 * it sits above the pill across a small gap — the card must stay mounted
 * through the leave-grace window or the pointer could never reach it.
 * Every entry point (advance, hover, leave) clears pending timers before
 * scheduling its own, so a `fade_start`/`hide` arriving while pinned can
 * only be the most recent `hover_off`'s own timer — never a stale one.
 */

import { motion } from "@proliferate/design/motion";

export const TODO_PILL_STEP_FADE_START_MS = motion.delay.todoPillStepLingerMs;
export const TODO_PILL_STEP_HIDE_MS = motion.delay.todoPillStepHideMs;
export const TODO_PILL_HOVER_FADE_START_MS = motion.delay.todoPillHoverLingerMs;
export const TODO_PILL_HOVER_HIDE_MS = motion.delay.todoPillHoverHideMs;

export interface TodoPillState {
  /** Whether the pill is mounted at all. */
  visible: boolean;
  /** Whether the pill is mid opacity-fade. */
  fading: boolean;
  /** Hover-pinned — reveals the checklist card and blocks fading until the
   * leave-fade fires. */
  pinned: boolean;
}

export type TodoPillAction =
  | { type: "step_advanced" }
  | { type: "hover_on" }
  | { type: "hover_off" }
  | { type: "fade_start" }
  | { type: "hide" };

export const INITIAL_TODO_PILL_STATE: TodoPillState = {
  visible: false,
  fading: false,
  pinned: false,
};

export function todoPillReducer(state: TodoPillState, action: TodoPillAction): TodoPillState {
  switch (action.type) {
    case "step_advanced":
      // A fresh step change always wins: reappear at full opacity, unpinned,
      // and let the timers restart the linger clock.
      return { visible: true, fading: false, pinned: false };
    case "hover_on":
      return { visible: true, fading: false, pinned: true };
    case "hover_off":
      // Stay pinned through the leave-grace so the checklist card remains
      // reachable; the connected component's leave timers end the grace.
      return state;
    case "fade_start":
      return { ...state, fading: true, pinned: false };
    case "hide":
      return state.pinned ? state : INITIAL_TODO_PILL_STATE;
    default:
      return state;
  }
}
