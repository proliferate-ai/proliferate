import { describe, expect, it, vi } from "vitest";
import {
  buildComposerSessionControlGroups,
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
    });

    expect(buildComposerSessionControlGroups([approvalMode, effort, collaborationMode])).toEqual({
      modeControl: collaborationMode,
      modelConfigControls: [approvalMode, effort],
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
      modelConfigControls: [],
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
    });

    expect(buildComposerSessionControlGroups([effort, cursorMode])).toEqual({
      modeControl: cursorMode,
      modelConfigControls: [effort],
    });
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
