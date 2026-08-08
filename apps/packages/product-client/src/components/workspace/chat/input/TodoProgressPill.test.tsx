// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanEntry } from "@anyharness/sdk";
import { TodoProgressPill } from "./TodoProgressPill";

const mocks = vi.hoisted(() => ({
  tracker: null as { entries: PlanEntry[] } | null,
  sessionId: "session-1" as string | null,
  reducedMotion: false,
}));

vi.mock("#product/hooks/chat/derived/use-active-todo-tracker", () => ({
  useActiveTodoTracker: () => mocks.tracker,
}));

vi.mock("#product/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => mocks.sessionId,
}));

vi.mock("#product/hooks/ui/motion/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: () => mocks.reducedMotion,
}));

function plan(completedCount: number, total: number): { entries: PlanEntry[] } {
  return {
    entries: Array.from({ length: total }, (_, index) => ({
      content: `step-${index}`,
      status: index < completedCount
        ? "completed"
        : index === completedCount
          ? "in_progress"
          : "pending",
    })),
  };
}

function pill() {
  return screen.queryByText(/Step \d+\/\d+/);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.tracker = null;
  mocks.sessionId = "session-1";
  mocks.reducedMotion = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TodoProgressPill", () => {
  it("shows nothing on a tracker's first appearance, then shows on an advance", () => {
    mocks.tracker = plan(1, 5);
    const { rerender } = render(<TodoProgressPill />);
    expect(pill()).toBeNull();

    mocks.tracker = plan(2, 5);
    rerender(<TodoProgressPill />);
    expect(pill()?.textContent).toBe("Step 3/5");
  });

  it("treats the final step completing as an advance despite the clamped step number", () => {
    mocks.tracker = plan(4, 5);
    const { rerender } = render(<TodoProgressPill />);
    expect(pill()).toBeNull();

    mocks.tracker = plan(5, 5);
    rerender(<TodoProgressPill />);
    expect(pill()?.textContent).toBe("Step 5/5");
  });

  it("lets a lingering pill finish its fade when the tracker clears, then hides", () => {
    mocks.tracker = plan(1, 3);
    const { rerender } = render(<TodoProgressPill />);
    mocks.tracker = plan(2, 3);
    rerender(<TodoProgressPill />);
    expect(pill()).not.toBeNull();

    mocks.tracker = null;
    rerender(<TodoProgressPill />);
    expect(pill()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(pill()).toBeNull();
  });

  it("does not read a session switch as a step advance", () => {
    mocks.tracker = plan(2, 7);
    const { rerender } = render(<TodoProgressPill />);
    expect(pill()).toBeNull();

    mocks.sessionId = "session-2";
    mocks.tracker = plan(5, 9);
    rerender(<TodoProgressPill />);
    expect(pill()).toBeNull();
  });

  it("unmounts at fade start under reduced motion instead of lingering at opacity 0", () => {
    mocks.reducedMotion = true;
    mocks.tracker = plan(1, 3);
    const { rerender } = render(<TodoProgressPill />);
    mocks.tracker = plan(2, 3);
    rerender(<TodoProgressPill />);
    expect(pill()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3400);
    });
    expect(pill()).toBeNull();
  });
});
