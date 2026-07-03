/* @vitest-environment jsdom */
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GoalCapabilities } from "@proliferate/product-domain/activity/goal";
import { GoalBar } from "./GoalBar";

afterEach(() => {
  cleanup();
});

const NOOP = () => {};

const NOT_SUPPORTED: GoalCapabilities = { supported: false, native: false, pause: false };
const SUPPORTED: GoalCapabilities = { supported: true, native: true, pause: true };

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
