import { describe, expect, it, vi } from "vitest";
import {
  buildComposerSessionControlGroups,
  filterComposerSessionControlsForSurface,
} from "./composer-control-groups";
import type { LiveSessionControlDescriptor } from "./session-controls";

describe("buildComposerSessionControlGroups", () => {
  it("pulls the primary planning mode control into the left composer mode slot", () => {
    const collaborationMode = descriptor({
      key: "collaboration_mode",
      label: "Mode",
      detail: "Default",
      options: [
        { value: "default", label: "Default", selected: true },
        { value: "plan", label: "Plan", selected: false },
      ],
    });
    const approvalMode = descriptor({
      key: "mode",
      label: "Permissions",
      detail: "Auto",
      options: [
        { value: "read-only", label: "Read Only", selected: false },
        { value: "auto", label: "Auto", selected: true },
      ],
    });
    const effort = descriptor({
      key: "effort",
      label: "Reasoning effort",
      detail: "High",
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "high", label: "High", selected: true },
      ],
    });

    expect(buildComposerSessionControlGroups([approvalMode, effort, collaborationMode])).toEqual({
      modeControl: collaborationMode,
      reasoningEffortControl: effort,
      fastModeControl: null,
      overflowControls: [approvalMode],
    });
  });

  it("deduplicates later controls before grouping", () => {
    const staleMode = descriptor({
      key: "collaboration_mode",
      label: "Mode",
      detail: "Default",
      options: [
        { value: "default", label: "Default", selected: true },
        { value: "plan", label: "Plan", selected: false },
      ],
    });
    const liveMode = descriptor({
      key: "collaboration_mode",
      label: "Mode",
      detail: "Plan",
      options: [
        { value: "default", label: "Default", selected: false },
        { value: "plan", label: "Plan", selected: true },
      ],
    });

    expect(buildComposerSessionControlGroups([staleMode, liveMode])).toEqual({
      modeControl: liveMode,
      reasoningEffortControl: null,
      fastModeControl: null,
      overflowControls: [],
    });
  });

  it("treats agent/plan/ask controls as the primary mode", () => {
    const cursorMode = descriptor({
      key: "mode",
      label: "Mode",
      detail: "Agent",
      options: [
        { value: "agent", label: "Agent", selected: true },
        { value: "plan", label: "Plan", selected: false },
        { value: "ask", label: "Ask", selected: false },
      ],
    });
    const effort = descriptor({
      key: "effort",
      label: "Reasoning effort",
      detail: "High",
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "high", label: "High", selected: true },
      ],
    });

    expect(buildComposerSessionControlGroups([effort, cursorMode])).toEqual({
      modeControl: cursorMode,
      reasoningEffortControl: effort,
      fastModeControl: null,
      overflowControls: [],
    });
  });

  it("keeps an access-only mode in overflow instead of promoting it as working mode", () => {
    const approvalMode = descriptor({
      key: "mode",
      label: "Permissions",
      detail: "Auto",
      options: [
        { value: "read-only", label: "Read Only", selected: false },
        { value: "auto", label: "Auto", selected: true },
        { value: "full-access", label: "Full Access", selected: false },
      ],
    });

    expect(buildComposerSessionControlGroups([approvalMode])).toEqual({
      modeControl: null,
      reasoningEffortControl: null,
      fastModeControl: null,
      overflowControls: [approvalMode],
    });
  });

  it("prefers collaboration mode whenever it exposes a real choice", () => {
    const collaborationMode = descriptor({
      key: "collaboration_mode",
      label: "Mode",
      detail: "Pair",
      options: [
        { value: "default", label: "Default", selected: false },
        { value: "pair", label: "Pair", selected: true },
      ],
    });
    const workingMode = descriptor({
      key: "mode",
      label: "Mode",
      detail: "Build",
      options: [
        { value: "build", label: "Build", selected: true },
        { value: "plan", label: "Plan", selected: false },
      ],
    });

    expect(buildComposerSessionControlGroups([workingMode, collaborationMode])).toEqual({
      modeControl: collaborationMode,
      reasoningEffortControl: null,
      fastModeControl: null,
      overflowControls: [workingMode],
    });
  });

  it("uses a two-level reasoning control as the bars fallback", () => {
    const reasoning = descriptor({
      key: "reasoning",
      label: "Reasoning",
      detail: "On",
      kind: "toggle",
      enabledValue: "on",
      disabledValue: "off",
      isEnabled: true,
      options: [
        { value: "off", label: "Off", selected: false },
        { value: "on", label: "On", selected: true },
      ],
    });

    expect(buildComposerSessionControlGroups([reasoning])).toEqual({
      modeControl: null,
      reasoningEffortControl: reasoning,
      fastModeControl: null,
      overflowControls: [],
    });
  });

  it("prefers effort over reasoning and leaves the unclaimed control in overflow", () => {
    const reasoning = descriptor({
      key: "reasoning",
      label: "Reasoning",
      detail: "High",
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "high", label: "High", selected: true },
      ],
    });
    const effort = descriptor({
      key: "effort",
      label: "Reasoning effort",
      detail: "Medium",
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "medium", label: "Medium", selected: true },
        { value: "high", label: "High", selected: false },
      ],
    });

    expect(buildComposerSessionControlGroups([reasoning, effort])).toEqual({
      modeControl: null,
      reasoningEffortControl: effort,
      fastModeControl: null,
      overflowControls: [reasoning],
    });
  });

  it("keeps a non-settable reasoning level visible as disabled bars", () => {
    const effort = descriptor({
      key: "effort",
      label: "Reasoning effort",
      detail: "High",
      settable: false,
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "high", label: "High", selected: true },
      ],
    });

    expect(buildComposerSessionControlGroups([effort])).toEqual({
      modeControl: null,
      reasoningEffortControl: effort,
      fastModeControl: null,
      overflowControls: [],
    });
  });

  it("promotes fast mode independently from reasoning and working mode", () => {
    const fastMode = descriptor({
      key: "fast_mode",
      label: "Fast mode",
      detail: "Off",
      kind: "toggle",
      enabledValue: "on",
      disabledValue: "off",
      isEnabled: false,
      options: [
        { value: "off", label: "Off", selected: true },
        { value: "on", label: "On", selected: false },
      ],
    });

    expect(buildComposerSessionControlGroups([fastMode])).toEqual({
      modeControl: null,
      reasoningEffortControl: null,
      fastModeControl: fastMode,
      overflowControls: [],
    });
  });
});

describe("filterComposerSessionControlsForSurface", () => {
  it("keeps Cowork working mode and fast mode while hiding its permission preset", () => {
    const approvalMode = descriptor({
      key: "mode",
      label: "Permissions",
      detail: "Full Access",
    });
    const collaborationMode = descriptor({
      key: "collaboration_mode",
      label: "Mode",
      detail: "Default",
    });
    const fastMode = descriptor({
      key: "fast_mode",
      label: "Fast mode",
      detail: "Off",
    });

    expect(filterComposerSessionControlsForSurface(
      [approvalMode, collaborationMode, fastMode],
      "cowork",
    )).toEqual([collaborationMode, fastMode]);
  });

  it("does not filter standard-workspace controls", () => {
    const approvalMode = descriptor({
      key: "mode",
      label: "Permissions",
      detail: "Full Access",
    });

    expect(filterComposerSessionControlsForSurface([approvalMode], "standard"))
      .toEqual([approvalMode]);
  });
});

function descriptor(
  overrides: Partial<LiveSessionControlDescriptor> & Pick<
    LiveSessionControlDescriptor,
    "key" | "label" | "detail"
  >,
): LiveSessionControlDescriptor {
  return {
    rawConfigId: overrides.key,
    settable: true,
    pendingState: null,
    kind: "select",
    options: [],
    onSelect: vi.fn(),
    ...overrides,
  };
}
