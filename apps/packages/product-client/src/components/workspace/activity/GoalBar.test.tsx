/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalCapabilities, GoalWire } from "#product/domain/activity/goal";
import { GoalBar } from "./GoalBar";

afterEach(() => {
  cleanup();
});

const NOOP = () => {};

const NOT_SUPPORTED: GoalCapabilities = {
  supported: false,
  native: false,
  pause: false,
  setEditTranscriptRows: false,
};
const SUPPORTED: GoalCapabilities = {
  supported: true,
  native: true,
  pause: true,
  setEditTranscriptRows: true,
};

function baseProps() {
  return {
    goal: null,
    capabilities: NOT_SUPPORTED,
    onEdit: NOOP,
    onPause: NOOP,
    onResume: NOOP,
    onClear: NOOP,
    onDismiss: NOOP,
  };
}

// Sticky results only render for attention-needing outcomes now (blocked/
// failed) — a met goal hides the bar because the transcript owns the success
// story. The sticky-result behaviors are covered via a blocked goal.
function blockedGoal(overrides: Partial<GoalWire> = {}): GoalWire {
  return {
    objective: "Get the payments integration test suite green",
    status: "blocked",
    nativeStatus: "blocked",
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    metReason: "File created successfully at: /Users/pablo/cowork/t-9f21/report.md",
    iterations: null,
    native: true,
    updatedAtMs: 1,
    ...overrides,
  };
}

describe("GoalBar", () => {
  it("renders nothing when there is no goal and no capability", () => {
    const { container } = render(<GoalBar {...baseProps()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is capability but no live/composing goal — the chips prop no longer keeps the bar alive", () => {
    // `ActivityChips` and the `chips` prop are retired (HANDOFF-background-
    // work.md — the docked chips go; the goal bar stays, but only when a goal
    // is live). This is a REPLACEMENT of the old "chips-only bar" behavior,
    // not a variant, so there is no prop left that can resurrect it.
    const { container } = render(<GoalBar {...baseProps()} capabilities={SUPPORTED} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the live goal row when a goal is supported and live", () => {
    render(
      <GoalBar
        {...baseProps()}
        capabilities={SUPPORTED}
        goal={{
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
        }}
      />,
    );
    expect(screen.getByText("Ship the feature")).toBeTruthy();
  });

  it("renders the empty-state composer editor while composing", () => {
    const { container } = render(
      <GoalBar {...baseProps()} capabilities={SUPPORTED} composing />,
    );
    expect(screen.getByLabelText("Goal objective")).toBeTruthy();
    expect(container.querySelector("[data-session-goal-bar] > div > svg")?.getAttribute("class")?.split(" "))
      .toContain("mt-[0.175em]");
  });
});

describe("GoalBar sticky result", () => {
  it("shows the OBJECTIVE on the collapsed line, never the raw met/blocked reason", () => {
    render(<GoalBar {...baseProps()} capabilities={SUPPORTED} goal={blockedGoal()} />);
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText(/Get the payments integration test suite green/)).toBeTruthy();
    // The raw evaluator reason (quoting tool output) must not appear on the
    // collapsed row — that's exactly the bug this redesign fixes.
    expect(screen.queryByText(/File created successfully/)).toBeNull();
  });

  it("exposes an expand trigger covering the row content, distinct from the dismiss button", () => {
    render(<GoalBar {...baseProps()} capabilities={SUPPORTED} goal={blockedGoal()} />);
    expect(screen.getByRole("button", { name: "Blocked — show details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss goal result" })).toBeTruthy();
  });

  it("dismisses the result via the dismiss button without needing the popover open", () => {
    const onDismiss = vi.fn();
    render(
      <GoalBar {...baseProps()} capabilities={SUPPORTED} goal={blockedGoal()} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss goal result" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders needs-you blocked framing with the same objective-first collapsed line", () => {
    render(
      <GoalBar
        {...baseProps()}
        capabilities={SUPPORTED}
        goal={blockedGoal({ status: "blocked", nativeStatus: "blocked", metReason: "needs you" })}
      />,
    );
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText(/Get the payments integration test suite green/)).toBeTruthy();
  });

  it("'Set new goal' opens the same blank compose editor as the empty-state affordance", () => {
    // GoalBar is display-only: the caller flips `composing` in response to
    // the popover's onSetNewGoal callback (see use-session-goal-actions'
    // beginComposing). This asserts the receiving half of that contract —
    // a result goal with composing=true renders the blank editor, not the
    // sticky result.
    render(
      <GoalBar {...baseProps()} capabilities={SUPPORTED} goal={blockedGoal()} composing />,
    );
    expect(screen.getByLabelText("Goal objective")).toBeTruthy();
    expect(screen.queryByText("Goal met")).toBeNull();
  });

  it("does not let composing override an already-live goal", () => {
    render(
      <GoalBar
        {...baseProps()}
        capabilities={SUPPORTED}
        goal={blockedGoal({ status: "active", nativeStatus: "active", metReason: null })}
        composing
      />,
    );
    expect(screen.getByText("Get the payments integration test suite green")).toBeTruthy();
    expect(screen.queryByLabelText("Goal objective")).toBeNull();
  });
});
