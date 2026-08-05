/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalBarState, GoalWire } from "@proliferate/product-domain/activity/goal";
import { GoalBarResultPopover } from "./GoalBarResultPopover";

afterEach(() => {
  cleanup();
});

function goal(overrides: Partial<GoalWire> = {}): GoalWire {
  return {
    objective: "Get the payments integration test suite green",
    status: "met",
    nativeStatus: "complete",
    tokenBudget: null,
    tokensUsed: null,
    timeUsedSeconds: null,
    metReason: null,
    iterations: null,
    native: true,
    updatedAtMs: 1,
    ...overrides,
  };
}

function metState(overrides: Partial<GoalWire> = {}): Extract<GoalBarState, { kind: "result" }> {
  const g = goal({
    status: "met",
    metReason: "File created successfully at: /Users/pablo/cowork/t-9f21/report.md",
    ...overrides,
  });
  return { kind: "result", outcome: "met", headline: "Goal met", detail: g.metReason, goal: g };
}

function blockedState(overrides: Partial<GoalWire> = {}): Extract<GoalBarState, { kind: "result" }> {
  const g = goal({
    status: "blocked",
    nativeStatus: "blocked",
    metReason: "Deploy requires a production database migration approval that only a human can grant.",
    ...overrides,
  });
  return { kind: "result", outcome: "blocked", headline: "Blocked", detail: g.metReason, goal: g };
}

describe("GoalBarResultPopover", () => {
  it("shows the full objective under a 'Goal' label and the full reason under an outcome-specific 'why' label", () => {
    render(<GoalBarResultPopover state={metState()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Goal")).toBeTruthy();
    expect(screen.getByText("Get the payments integration test suite green")).toBeTruthy();
    expect(screen.getByText("Why it's met")).toBeTruthy();
    expect(screen.getByText("File created successfully at: /Users/pablo/cowork/t-9f21/report.md")).toBeTruthy();
  });

  it("labels the blocked reason with needs-you framing", () => {
    render(<GoalBarResultPopover state={blockedState()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Why it's blocked")).toBeTruthy();
    expect(screen.getByText(/production database migration approval/)).toBeTruthy();
  });

  it("omits the why section when the harness gave no reason", () => {
    render(
      <GoalBarResultPopover
        state={{ kind: "result", outcome: "met", headline: "Goal met", detail: null, goal: goal({ metReason: null }) }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByText("Why it's met")).toBeNull();
  });

  it("renders a compact stats row only when usage data exists", () => {
    const { rerender } = render(<GoalBarResultPopover state={metState()} onDismiss={vi.fn()} />);
    expect(screen.queryByText(/tokens/)).toBeNull();

    rerender(
      <GoalBarResultPopover
        state={metState({ iterations: 4, tokensUsed: 41_872, timeUsedSeconds: 312 })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("4 iterations")).toBeTruthy();
    expect(screen.getByText("41,872 tokens")).toBeTruthy();
    expect(screen.getByText("5m 12s")).toBeTruthy();
  });

  it("fires onDismiss from the footer action", () => {
    const onDismiss = vi.fn();
    render(<GoalBarResultPopover state={metState()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("only renders 'Set new goal' when the caller supplies the handler, and fires it on click", () => {
    const { rerender } = render(<GoalBarResultPopover state={metState()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Set new goal" })).toBeNull();

    const onSetNewGoal = vi.fn();
    rerender(<GoalBarResultPopover state={metState()} onDismiss={vi.fn()} onSetNewGoal={onSetNewGoal} />);
    fireEvent.click(screen.getByRole("button", { name: "Set new goal" }));
    expect(onSetNewGoal).toHaveBeenCalledTimes(1);
  });
});
