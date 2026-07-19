// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AnimatedSwapText } from "../src/primitives/AnimatedSwapText";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AnimatedSwapText", () => {
  it("renders the initial value without mount animation", () => {
    const { container } = render(
      <AnimatedSwapText valueKey="default" value="Default" />,
    );

    expect(screen.getByText("Default")).toBeTruthy();
    expect(container.querySelector(".composer-value-enter")).toBeNull();
    expect(container.querySelector(".composer-value-exit")).toBeNull();
  });

  it("renders the incoming value immediately and retires the outgoing value", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <AnimatedSwapText valueKey="default" value="Default" />,
    );

    rerender(<AnimatedSwapText valueKey="plan" value="Plan" />);

    expect(screen.getByText("Plan").className).toBe("composer-value-enter");
    const outgoing = screen.getByText("Default");
    expect(outgoing.getAttribute("aria-hidden")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(240);
    });

    expect(container.querySelector(".composer-value-exit")).toBeNull();
    expect(screen.getByText("Plan")).toBeTruthy();
  });

  it("converges on the latest value during rapid swaps", () => {
    const { rerender } = render(
      <AnimatedSwapText valueKey="default" value="Default" />,
    );

    rerender(<AnimatedSwapText valueKey="plan" value="Plan" />);
    rerender(<AnimatedSwapText valueKey="bypass" value="Bypass" />);

    expect(screen.getByText("Bypass").className).toBe("composer-value-enter");
    expect(screen.getByText("Plan").getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Default")).toBeNull();
  });
});
