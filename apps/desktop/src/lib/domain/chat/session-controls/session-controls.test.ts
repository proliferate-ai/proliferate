import { describe, expect, it, vi } from "vitest";
import type { NormalizedSessionControls } from "@anyharness/sdk";
import type { NormalizedSessionControl } from "@anyharness/sdk";
import {
  buildLiveSessionControlDescriptors,
  isReasoningControlActive,
  mergeSessionConfigControlDescriptors,
  type LiveSessionControlDescriptor,
} from "./session-controls";

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

describe("mergeSessionConfigControlDescriptors", () => {
  it("keeps catalog order and labels while using live values and setters", () => {
    const launchMode = descriptor({
      key: "mode",
      label: "Approval Preset",
      detail: "Default",
      rawConfigId: "mode",
    });
    const launchReasoning = descriptor({
      key: "effort",
      label: "Reasoning Effort",
      detail: "Medium",
      rawConfigId: "effort",
    });
    const liveMode = descriptor({
      key: "mode",
      label: "Permissions",
      detail: "Full Access",
      rawConfigId: "approval_mode",
    });
    const liveReasoning = descriptor({
      key: "effort",
      label: "Reasoning effort",
      detail: "High",
      rawConfigId: "reasoning_effort",
    });

    expect(mergeSessionConfigControlDescriptors(
      [launchMode, launchReasoning],
      [liveReasoning, liveMode],
    )).toMatchObject([
      {
        key: "mode",
        label: "Approval Preset",
        detail: "Full Access",
        rawConfigId: "approval_mode",
      },
      {
        key: "effort",
        label: "Reasoning Effort",
        detail: "High",
        rawConfigId: "reasoning_effort",
      },
    ]);
  });
});

describe("isReasoningControlActive", () => {
  const reasoningControl = (
    currentValue: string | null,
    values: { value: string; label: string }[],
  ): NormalizedSessionControl => ({
    key: "reasoning",
    rawConfigId: "reasoning",
    label: "Reasoning",
    currentValue,
    settable: true,
    values,
  });

  it("is inactive without a control or selected value", () => {
    expect(isReasoningControlActive(null)).toBe(false);
    expect(isReasoningControlActive(undefined)).toBe(false);
    expect(isReasoningControlActive(
      reasoningControl(null, [{ value: "on", label: "On" }]),
    )).toBe(false);
  });

  it("treats off/none toggle values as inactive", () => {
    const toggle = [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
    ];
    expect(isReasoningControlActive(reasoningControl("off", toggle))).toBe(false);
    expect(isReasoningControlActive(reasoningControl("on", toggle))).toBe(true);
  });

  it("treats a non-none multi-value selection as active", () => {
    const levels = [
      { value: "none", label: "None" },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ];
    expect(isReasoningControlActive(reasoningControl("none", levels))).toBe(false);
    expect(isReasoningControlActive(reasoningControl("high", levels))).toBe(true);
  });
});

function descriptor(
  overrides: Partial<LiveSessionControlDescriptor> & Pick<
    LiveSessionControlDescriptor,
    "key" | "label" | "detail" | "rawConfigId"
  >,
): LiveSessionControlDescriptor {
  return {
    settable: true,
    pendingState: null,
    kind: "select",
    options: [],
    onSelect: vi.fn(),
    ...overrides,
  };
}
