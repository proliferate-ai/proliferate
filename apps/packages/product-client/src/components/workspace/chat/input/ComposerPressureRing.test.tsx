// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerPressureRing } from "#product/components/workspace/chat/input/ComposerPressureRing";
import type {
  RuntimePressureControlState,
  RuntimePressureTargetState,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";

const mocks = vi.hoisted(() => ({
  state: null as RuntimePressureControlState | null,
}));

vi.mock("#product/hooks/workspaces/facade/use-runtime-pressure-control-state", () => ({
  useRuntimePressureControlState: () => mocks.state,
}));

function createIndicator(
  overrides: Partial<RuntimePressureTargetState> = {},
): RuntimePressureTargetState {
  return {
    pressurePercent: 40,
    pressureLimitPercent: 100,
    ringProgressPercent: 40,
    pressureLabel: "4/10 worktrees",
    detailLines: ["4 materialized worktrees in proliferate", "Ideal max 10"],
    tone: "success",
    pressureRepoLabel: "proliferate",
    ...overrides,
  } as RuntimePressureTargetState;
}

function createState(
  indicator: RuntimePressureTargetState | null,
  visible = true,
): RuntimePressureControlState {
  return {
    visible,
    indicator,
    targets: indicator ? [indicator] : [],
    isDiscovering: false,
    actions: {},
  } as unknown as RuntimePressureControlState;
}

afterEach(() => {
  cleanup();
  mocks.state = null;
});

describe("ComposerPressureRing", () => {
  it("renders nothing when the pressure facade has no target", () => {
    mocks.state = createState(null, false);
    const { container } = render(<ComposerPressureRing />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the target reports no ring progress", () => {
    mocks.state = createState(createIndicator({ ringProgressPercent: null }));
    const { container } = render(<ComposerPressureRing />);
    expect(container.innerHTML).toBe("");
  });

  it("draws the arc from the facade's ring progress and stays neutral below the threshold", () => {
    mocks.state = createState(createIndicator());
    render(<ComposerPressureRing />);

    const trigger = screen.getByRole("button", { name: /4\/10 worktrees/ });
    const arc = trigger.querySelectorAll("circle")[1]!;
    // 43.98 × (1 − 0.40): the ring's own dash math, not a percentage stroke.
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(26.388, 3);
    expect(arc.getAttribute("class")).toContain("stroke-muted-foreground");
    expect(trigger.getAttribute("data-runtime-pressure-over-threshold")).toBeNull();
  });

  it("turns destructive at 85% of the target's own limit, never warning", () => {
    mocks.state = createState(createIndicator({
      pressurePercent: 60,
      pressureLimitPercent: 70,
      ringProgressPercent: 85.7,
      pressureLabel: "60% pressure",
    }));
    render(<ComposerPressureRing />);

    const trigger = screen.getByRole("button", { name: /60% pressure/ });
    const arc = trigger.querySelectorAll("circle")[1]!;
    expect(arc.getAttribute("class")).toContain("stroke-destructive");
    expect(arc.getAttribute("class")).not.toContain("warning");
    expect(trigger.getAttribute("data-runtime-pressure-over-threshold")).toBe("");
  });

  it("opens a read-only details popover with the facade's own copy", () => {
    mocks.state = createState(createIndicator());
    render(<ComposerPressureRing />);

    fireEvent.click(screen.getByRole("button", { name: /4\/10 worktrees/ }));

    expect(screen.getByText("proliferate")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("Ideal max 10")).toBeTruthy();
  });
});
