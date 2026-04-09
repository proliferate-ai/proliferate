import { describe, expect, it, vi } from "vitest";
import type { NormalizedSessionControls } from "@anyharness/sdk";
import { buildLiveSessionControlDescriptors } from "./session-controls";

const NORMALIZED_CONTROLS: NormalizedSessionControls = {
  model: null,
  collaborationMode: null,
  mode: null,
  reasoning: null,
  effort: {
    key: "effort",
    rawConfigId: "effort",
    label: "Effort",
    currentValue: "high",
    settable: true,
    values: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  fastMode: {
    key: "fast_mode",
    rawConfigId: "fast_mode",
    label: "Fast Mode",
    currentValue: "off",
    settable: true,
    values: [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ],
  },
  extras: [],
};

describe("buildLiveSessionControlDescriptors", () => {
  it("uses the pending value and pending state for the matching control", () => {
    const onSelect = vi.fn();

    const controls = buildLiveSessionControlDescriptors(
      NORMALIZED_CONTROLS,
      {
        effort: {
          rawConfigId: "effort",
          value: "medium",
          status: "queued",
          mutationId: 2,
        },
      },
      onSelect,
    );

    expect(controls).toEqual([
      {
        key: "effort",
        label: "Reasoning effort",
        detail: "Medium",
        rawConfigId: "effort",
        settable: true,
        pendingState: "queued",
        kind: "select",
        options: [
          { value: "low", label: "Low", description: undefined, selected: false },
          { value: "medium", label: "Medium", description: undefined, selected: true },
          { value: "high", label: "High", description: undefined, selected: false },
        ],
        onSelect: expect.any(Function),
      },
      {
        key: "fast_mode",
        label: "Fast mode",
        detail: "Off",
        rawConfigId: "fast_mode",
        settable: true,
        pendingState: null,
        kind: "toggle",
        enabledValue: "on",
        disabledValue: "off",
        isEnabled: false,
        options: [
          { value: "off", label: "Off", description: undefined, selected: true },
          { value: "on", label: "On", description: undefined, selected: false },
        ],
        onSelect: expect.any(Function),
      },
    ]);

    controls[0]?.onSelect("low");
    expect(onSelect).toHaveBeenCalledWith("effort", "low");
  });

  it("shows the latest pending value for the same raw config id", () => {
    const controls = buildLiveSessionControlDescriptors(
      NORMALIZED_CONTROLS,
      {
        fast_mode: {
          rawConfigId: "fast_mode",
          value: "on",
          status: "submitting",
          mutationId: 4,
        },
      },
      vi.fn(),
    );

    expect(controls.find((control) => control.rawConfigId === "fast_mode")).toMatchObject({
      detail: "On",
      pendingState: "submitting",
      isEnabled: true,
      options: [
        { value: "off", selected: false },
        { value: "on", selected: true },
      ],
    });
  });
});
