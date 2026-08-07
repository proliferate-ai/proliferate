/**
 * Pure show -> linger -> fade -> hide state machine for the floating todo
 * progress pill (`TodoProgressPill.tsx`). Timers live in the connected
 * component; this module only knows the state transitions, so it can be
 * tested without React or fake timers touching the DOM.
 *
 * Timings straight from the design handoff
 * (`design_handoff_composer_dock/Todos.dc.html`, `_simulateStep`/`pillHoverOn`/
 * `pillHoverOff`):
 *   - a step advancing shows the pill, fade starts at 3.4s, hidden by 4s
 *   - hovering pins the pill (cancels any fade) and reveals the checklist
 *   - mouse-leave unpins and restarts a short fade: starts at 1.2s, hidden by 1.8s
 */

export const TODO_PILL_STEP_FADE_START_MS = 3400;
export const TODO_PILL_STEP_HIDE_MS = 4000;
export const TODO_PILL_HOVER_FADE_START_MS = 1200;
export const TODO_PILL_HOVER_HIDE_MS = 1800;

export interface TodoPillState {
  /** Whether the pill is mounted at all. */
  visible: boolean;
  /** Whether the pill is mid opacity-fade (ignored while `pinned`). */
  fading: boolean;
  /** Hovered — cancels fade timers and reveals the checklist card. */
  pinned: boolean;
}

export type TodoPillAction =
  | { type: "step_advanced" }
  | { type: "hover_on" }
  | { type: "hover_off" }
  | { type: "fade_start" }
  | { type: "hide" }
  | { type: "tracker_cleared" };

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
      return { ...state, pinned: false };
    case "fade_start":
      return state.pinned ? state : { ...state, fading: true };
    case "hide":
      return state.pinned ? state : INITIAL_TODO_PILL_STATE;
    case "tracker_cleared":
      return INITIAL_TODO_PILL_STATE;
    default:
      return state;
  }
}
