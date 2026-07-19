// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionModeControl } from "#product/components/workspace/chat/input/SessionModeControl";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

afterEach(cleanup);

describe("SessionModeControl", () => {
  it("cycles compact mode values on click without opening a menu", () => {
    const onSelect = vi.fn();

    function Harness() {
      const [selectedValue, setSelectedValue] = useState("default");
      const control: LiveSessionControlDescriptor & { key: "collaboration_mode" } = {
        key: "collaboration_mode",
        label: "Mode",
        detail: selectedValue === "plan" ? "Plan" : "Default",
        rawConfigId: "collaboration_mode",
        settable: true,
        pendingState: selectedValue === "plan" ? "submitting" : null,
        kind: "select",
        options: [
          { value: "default", label: "Default", selected: selectedValue === "default" },
          { value: "plan", label: "Plan", selected: selectedValue === "plan" },
          { value: "bypass", label: "Bypass", selected: selectedValue === "bypass" },
        ],
        onSelect: (value) => {
          onSelect(value);
          setSelectedValue(value);
        },
      };
      return (
        <SessionModeControl
          agentKind="codex"
          control={control}
          triggerStyle="value"
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Mode: Default" }));
    expect(onSelect).toHaveBeenCalledWith("plan");
    expect(screen.getByRole("button", { name: "Mode: Plan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mode: Plan" }));
    expect(onSelect).toHaveBeenLastCalledWith("bypass");
    expect(screen.getByRole("button", { name: "Mode: Bypass" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mode: Bypass" }));
    expect(onSelect).toHaveBeenLastCalledWith("default");
    expect(screen.getByRole("button", { name: "Mode: Default" })).toBeTruthy();
  });

  it("keeps the full settings control as an explicit option menu", () => {
    const onSelect = vi.fn();
    const control: LiveSessionControlDescriptor & { key: "collaboration_mode" } = {
      key: "collaboration_mode",
      label: "Mode",
      detail: "Default",
      rawConfigId: "collaboration_mode",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        { value: "default", label: "Default", selected: true },
        { value: "plan", label: "Plan", selected: false },
      ],
      onSelect,
    };

    render(<SessionModeControl agentKind="codex" control={control} />);
    fireEvent.click(screen.getByRole("button", { name: "Mode: Default" }));
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    expect(onSelect).toHaveBeenCalledWith("plan");
  });
});
