/* @vitest-environment jsdom */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalCapabilities, GoalWire } from "@proliferate/product-domain/activity/goal";
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
    chips: undefined as ReactNode,
  };
}

function metGoal(overrides: Partial<GoalWire> = {}): GoalWire {
  return {
    objective: "Get the payments integration test suite green",
    status: "met",
    nativeStatus: "complete",
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

describe("GoalBar chips", () => {
  it("renders nothing when there is no goal, no capability, and no chips", () => {
    const { container } = render(<GoalBar {...baseProps()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a chips-only bar when goal is unsupported/unset but chips are present", () => {
    render(<GoalBar {...baseProps()} chips={<span>2 loops</span>} />);
    expect(screen.getByText("2 loops")).toBeTruthy();
    // No goal glyph/label content should render alongside the chips-only bar.
    expect(screen.queryByLabelText("Goal objective")).toBeNull();
  });

  it("stacks chips on the same row as a live goal", () => {
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
        chips={<span>2 loops</span>}
      />,
    );
    expect(screen.getByText("Ship the feature")).toBeTruthy();
    expect(screen.getByText("2 loops")).toBeTruthy();
  });

  it("suppresses chips while the empty-state composer editor is open", () => {
    render(
      <GoalBar
        {...baseProps()}
        capabilities={SUPPORTED}
        composing
        chips={<span>2 loops</span>}
      />,
    );
    expect(screen.getByLabelText("Goal objective")).toBeTruthy();
    expect(screen.queryByText("2 loops")).toBeNull();
  });

  it("preserves the original hidden behavior when chips are absent", () => {
    const { container } = render(<GoalBar {...baseProps()} capabilities={SUPPORTED} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("GoalBar sticky result", () => {
  it("shows the OBJECTIVE on the collapsed line, never the raw met/blocked reason", () => {
    render(<GoalBar {...baseProps()} capabilities={SUPPORTED} goal={metGoal()} />);
    expect(screen.getByText("Goal met")).toBeTruthy();
    expect(screen.getByText(/Get the payments integration test suite green/)).toBeTruthy();
    // The raw evaluator reason (quoting tool output) must not appear on the
    // collapsed row — that's exactly the bug this redesign fixes.
    expect(screen.queryByText(/File created successfully/)).toBeNull();
  });

  it("exposes an expand trigger covering the row content, distinct from the dismiss button", () => {
    render(<GoalBar {...baseProps()} capabilities={SUPPORTED} goal={metGoal()} />);
    expect(screen.getByRole("button", { name: "Goal met — show details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss goal result" })).toBeTruthy();
  });

  it("dismisses the result via the dismiss button without needing the popover open", () => {
    const onDismiss = vi.fn();
    render(
      <GoalBar {...baseProps()} capabilities={SUPPORTED} goal={metGoal()} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss goal result" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders needs-you blocked framing with the same objective-first collapsed line", () => {
    render(
      <GoalBar
        {...baseProps()}
        capabilities={SUPPORTED}
        goal={metGoal({ status: "blocked", nativeStatus: "blocked", metReason: "needs you" })}
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
      <GoalBar {...baseProps()} capabilities={SUPPORTED} goal={metGoal()} composing />,
    );
    expect(screen.getByLabelText("Goal objective")).toBeTruthy();
    expect(screen.queryByText("Goal met")).toBeNull();
  });

  it("does not let composing override an already-live goal", () => {
    render(
      <GoalBar
        {...baseProps()}
        capabilities={SUPPORTED}
        goal={metGoal({ status: "active", nativeStatus: "active", metReason: null })}
        composing
      />,
    );
    expect(screen.getByText("Get the payments integration test suite green")).toBeTruthy();
    expect(screen.queryByLabelText("Goal objective")).toBeNull();
  });
});
