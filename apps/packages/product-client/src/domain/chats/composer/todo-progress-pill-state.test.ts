import { describe, expect, it } from "vitest";
import {
  INITIAL_TODO_PILL_STATE,
  todoPillReducer,
  type TodoPillState,
} from "./todo-progress-pill-state";

describe("todoPillReducer", () => {
  it("starts hidden", () => {
    expect(INITIAL_TODO_PILL_STATE).toEqual({ visible: false, fading: false, pinned: false });
  });

  it("shows the pill on a step advance, resetting fade and pin", () => {
    const faded: TodoPillState = { visible: true, fading: true, pinned: true };
    expect(todoPillReducer(faded, { type: "step_advanced" })).toEqual({
      visible: true,
      fading: false,
      pinned: false,
    });
  });

  it("pins on hover, cancelling any fade", () => {
    const fading: TodoPillState = { visible: true, fading: true, pinned: false };
    expect(todoPillReducer(fading, { type: "hover_on" })).toEqual({
      visible: true,
      fading: false,
      pinned: true,
    });
  });

  it("unpins on hover-off but leaves visibility/fade untouched", () => {
    const pinned: TodoPillState = { visible: true, fading: false, pinned: true };
    expect(todoPillReducer(pinned, { type: "hover_off" })).toEqual({
      visible: true,
      fading: false,
      pinned: false,
    });
  });

  it("starts fading when not pinned", () => {
    const shown: TodoPillState = { visible: true, fading: false, pinned: false };
    expect(todoPillReducer(shown, { type: "fade_start" })).toEqual({
      visible: true,
      fading: true,
      pinned: false,
    });
  });

  it("ignores fade_start while pinned", () => {
    const pinned: TodoPillState = { visible: true, fading: false, pinned: true };
    expect(todoPillReducer(pinned, { type: "fade_start" })).toEqual(pinned);
  });

  it("hides once the linger timer fires while not pinned", () => {
    const fading: TodoPillState = { visible: true, fading: true, pinned: false };
    expect(todoPillReducer(fading, { type: "hide" })).toEqual(INITIAL_TODO_PILL_STATE);
  });

  it("ignores hide while pinned (a re-hover raced the timer)", () => {
    const pinned: TodoPillState = { visible: true, fading: false, pinned: true };
    expect(todoPillReducer(pinned, { type: "hide" })).toEqual(pinned);
  });

  it("resets to hidden when the tracker disappears", () => {
    const shown: TodoPillState = { visible: true, fading: false, pinned: true };
    expect(todoPillReducer(shown, { type: "tracker_cleared" })).toEqual(INITIAL_TODO_PILL_STATE);
  });
});
