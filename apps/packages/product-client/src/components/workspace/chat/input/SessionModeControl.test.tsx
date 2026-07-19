// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionModeControl } from "#product/components/workspace/chat/input/SessionModeControl";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

afterEach(cleanup);

describe("SessionModeControl", () => {
  it("updates through the control callback and closes the menu on pointer selection", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    expect(onSelect).toHaveBeenCalledWith("plan");
    expect(screen.getByRole("button", { name: "Mode: Plan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();
  });
});
