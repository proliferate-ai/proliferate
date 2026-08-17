/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionGoalBarModel } from "#product/hooks/activity/derived/use-session-goal";
import type { SessionGoalActions } from "#product/hooks/activity/workflows/use-session-goal-actions";
import { SessionActivityBar } from "./SessionActivityBar";

const NOOP = () => {};
const GOAL_ACTIONS: SessionGoalActions = {
  editGoal: NOOP,
  pauseGoal: NOOP,
  resumeGoal: NOOP,
  clearGoal: NOOP,
  dismissResult: NOOP,
  beginComposing: NOOP,
  cancelComposing: NOOP,
  pendingWrite: false,
};

let goalBarModel: SessionGoalBarModel | null = null;

vi.mock("#product/hooks/activity/derived/use-session-goal", () => ({
  useSessionGoalBarModel: () => goalBarModel,
}));
vi.mock("#product/hooks/activity/workflows/use-session-goal-actions", () => ({
  useSessionGoalActions: () => GOAL_ACTIONS,
}));

afterEach(() => {
  goalBarModel = null;
  cleanup();
});

describe("SessionActivityBar", () => {
  it("returns null when there is no goal model — chips no longer keep the bar alive", () => {
    goalBarModel = null;
    const { container } = render(<SessionActivityBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the goal bar's live row when a goal model is present", () => {
    goalBarModel = {
      goal: {
        objective: "Ship the feature",
        status: "active",
        nativeStatus: "active",
        tokenBudget: null,
        tokensUsed: null,
        timeUsedSeconds: null,
        metReason: null,
        iterations: null,
        native: true,
        updatedAtMs: 1,
      },
      capabilities: { supported: true, native: true, pause: true, setEditTranscriptRows: true },
      composing: false,
      provisional: false,
    };
    render(<SessionActivityBar />);
    expect(screen.getByText("Ship the feature")).toBeTruthy();
  });

  it("no longer derives or renders roster chips — deriveActivityChips/ActivityChips are retired", () => {
    goalBarModel = {
      goal: null,
      capabilities: { supported: true, native: true, pause: true, setEditTranscriptRows: true },
      composing: true,
      provisional: false,
    };
    const { container } = render(<SessionActivityBar />);
    expect(container.querySelector("[data-session-activity-chips]")).toBeNull();
  });
});
