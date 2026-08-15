// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerEffortStepper } from "#product/components/workspace/chat/input/ComposerEffortStepper";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "#product/lib/domain/shortcuts/registry";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

afterEach(() => {
  cleanup();
  clearShortcutHandlerRegistryForTests();
});

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

// The stepper registers its ⌃⇧E handler against the current route, so every
// render needs a router; "/" is the main screen where the shortcut is live.
function renderStepper(control: LiveSessionControlDescriptor, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ComposerEffortStepper control={control} />
    </MemoryRouter>,
  );
}

describe("ComposerEffortStepper", () => {
  it("lights one bar per level on a fixed six-bar ladder", () => {
    renderStepper(createEffortControl("medium"));

    const ladder = screen
      .getByRole("button", { name: "Reasoning: Medium" })
      .querySelector("[data-reasoning-effort-ladder]");
    expect(ladder?.getAttribute("data-reasoning-effort-ladder-lit")).toBe("2");
    expect(ladder?.querySelectorAll("rect").length).toBe(6);
  });

  it("steps to the next level on click", () => {
    const control = createEffortControl("medium");
    renderStepper(control);

    fireEvent.click(screen.getByRole("button", { name: "Reasoning: Medium" }));
    expect(control.onSelect).toHaveBeenCalledWith("high");
  });

  it("wraps from the top level back to the bottom", () => {
    const control = createEffortControl("high");
    renderStepper(control);

    fireEvent.click(screen.getByRole("button", { name: "Reasoning: High" }));
    expect(control.onSelect).toHaveBeenCalledWith("low");
  });

  it("steps backward on a modifier click", () => {
    const control = createEffortControl("medium");
    renderStepper(control);

    fireEvent.click(screen.getByRole("button", { name: "Reasoning: Medium" }), { metaKey: true });
    expect(control.onSelect).toHaveBeenCalledWith("low");
  });

  it("wraps backward from the bottom level to the top on a modifier click", () => {
    const control = createEffortControl("low");
    renderStepper(control);

    fireEvent.click(screen.getByRole("button", { name: "Reasoning: Low" }), { ctrlKey: true });
    expect(control.onSelect).toHaveBeenCalledWith("high");
  });

  it("steps the same transition through the cycle-reasoning-effort shortcut", () => {
    const control = createEffortControl("medium");
    renderStepper(control);

    expect(runShortcutHandler("workspace.cycle-reasoning-effort", { source: "keyboard" }))
      .toBe(true);
    expect(control.onSelect).toHaveBeenCalledWith("high");
  });

  it("steps backward through the cycle-reasoning-effort-back shortcut", () => {
    const control = createEffortControl("medium");
    renderStepper(control);

    expect(runShortcutHandler("workspace.cycle-reasoning-effort-back", { source: "keyboard" }))
      .toBe(true);
    expect(control.onSelect).toHaveBeenCalledWith("low");
  });

  it("does not register the shortcut away from the main screen", () => {
    const control = createEffortControl("medium");
    renderStepper(control, "/settings");

    expect(runShortcutHandler("workspace.cycle-reasoning-effort", { source: "keyboard" }))
      .toBe(false);
    expect(runShortcutHandler("workspace.cycle-reasoning-effort-back", { source: "keyboard" }))
      .toBe(false);
    expect(control.onSelect).not.toHaveBeenCalled();
  });

  it("carries the step hint in the tooltip copy", () => {
    renderStepper(createEffortControl("medium"));

    const trigger = screen.getByRole("button", { name: "Reasoning: Medium" });
    // jsdom's default navigator is non-Apple, so the hint reads "Ctrl click".
    expect(trigger.getAttribute("title")).toContain("Click to step, Ctrl click to step back.");
  });

  it("does not register the shortcut when the level is not settable", () => {
    const control = createEffortControl("medium", { settable: false });
    renderStepper(control);

    expect(runShortcutHandler("workspace.cycle-reasoning-effort", { source: "keyboard" }))
      .toBe(false);
    expect(control.onSelect).not.toHaveBeenCalled();
  });

  it("disables the stepper when the level is not settable", () => {
    const control = createEffortControl("medium", { settable: false });
    renderStepper(control);

    const trigger = screen.getByRole("button", { name: "Reasoning: Medium" });
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(control.onSelect).not.toHaveBeenCalled();
  });

  it("disables the stepper when the ladder has only one rung", () => {
    // A one-option ladder has nowhere to step: stepping would re-select the
    // level already selected, so the control still reads but cannot be pressed.
    const control = createEffortControl("medium", {
      options: [{ value: "medium", label: "Medium", selected: true }],
    });
    renderStepper(control);

    const trigger = screen.getByRole("button", { name: "Reasoning: Medium" });
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(control.onSelect).not.toHaveBeenCalled();
  });

  it("carries no tier tone: every level draws the same ink", () => {
    const { container: low } = renderStepper(createEffortControl("low"));
    const lowClass = low.querySelector("button")!.className;
    cleanup();
    const { container: high } = renderStepper(createEffortControl("high"));
    expect(high.querySelector("button")!.className).toBe(lowClass);
  });
});
