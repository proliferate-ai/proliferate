// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LevelBarsButton } from "../src/primitives/LevelBarsButton";

afterEach(cleanup);

describe("LevelBarsButton", () => {
  const levels = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  it("renders the current level label", () => {
    const onStep = vi.fn();
    render(<LevelBarsButton levels={levels} currentIndex={1} onStep={onStep} />);

    expect(screen.getByText("Medium")).toBeTruthy();
  });

  it("renders N bars matching the levels count", () => {
    const onStep = vi.fn();
    const { container } = render(
      <LevelBarsButton levels={levels} currentIndex={0} onStep={onStep} />,
    );

    const svg = container.querySelector("svg");
    expect(svg?.querySelectorAll("rect").length).toBe(3);
  });

  it("advances to the next level on click", () => {
    const onStep = vi.fn();
    render(<LevelBarsButton levels={levels} currentIndex={0} onStep={onStep} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onStep).toHaveBeenCalledWith("medium");
  });

  it("wraps to index 0 when clicking past the last level", () => {
    const onStep = vi.fn();
    render(<LevelBarsButton levels={levels} currentIndex={2} onStep={onStep} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onStep).toHaveBeenCalledWith("low");
  });

  it("respects disabled state", () => {
    const onStep = vi.fn();
    render(
      <LevelBarsButton levels={levels} currentIndex={0} onStep={onStep} disabled />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onStep).not.toHaveBeenCalled();
  });
});
