// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerEffortStepper } from "#product/components/workspace/chat/input/ComposerEffortStepper";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

afterEach(cleanup);

function createEffortControl(
  selectedValue: string,
  overrides: Partial<LiveSessionControlDescriptor> = {},
): LiveSessionControlDescriptor {
  return {
    key: "effort",
    label: "Reasoning effort",
    detail: "Medium",
    rawConfigId: "effort",
    settable: true,
    pendingState: null,
    kind: "select",
    options: [
      { value: "low", label: "Low", selected: selectedValue === "low" },
      { value: "medium", label: "Medium", selected: selectedValue === "medium" },
      { value: "high", label: "High", selected: selectedValue === "high" },
    ],
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe("ComposerEffortStepper", () => {
  it("lights one bar per level on a fixed six-bar ladder", () => {
    render(<ComposerEffortStepper control={createEffortControl("medium")} />);

    const ladder = screen
      .getByRole("button", { name: "Reasoning: Medium" })
      .querySelector("[data-effort-ladder]");
    expect(ladder?.getAttribute("data-effort-ladder-lit")).toBe("2");
    expect(ladder?.querySelectorAll("rect").length).toBe(6);
  });

  it("steps to the next level on click", () => {
    const control = createEffortControl("medium");
    render(<ComposerEffortStepper control={control} />);

    fireEvent.click(screen.getByRole("button", { name: "Reasoning: Medium" }));
    expect(control.onSelect).toHaveBeenCalledWith("high");
  });

  it("wraps from the top level back to the bottom", () => {
    const control = createEffortControl("high");
    render(<ComposerEffortStepper control={control} />);

    fireEvent.click(screen.getByRole("button", { name: "Reasoning: High" }));
    expect(control.onSelect).toHaveBeenCalledWith("low");
  });

  it("disables the stepper when the level is not settable", () => {
    const control = createEffortControl("medium", { settable: false });
    render(<ComposerEffortStepper control={control} />);

    const trigger = screen.getByRole("button", { name: "Reasoning: Medium" });
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(control.onSelect).not.toHaveBeenCalled();
  });

  it("carries no tier tone: every level draws the same ink", () => {
    const { container: low } = render(
      <ComposerEffortStepper control={createEffortControl("low")} />,
    );
    const lowClass = low.querySelector("button")!.className;
    cleanup();
    const { container: high } = render(
      <ComposerEffortStepper control={createEffortControl("high")} />,
    );
    expect(high.querySelector("button")!.className).toBe(lowClass);
  });
});
