import { describe, expect, it } from "vitest";
import type { WorkspaceSessionLaunchControl } from "@anyharness/sdk";
import { buildLaunchControlDescriptors } from "./use-chat-model-selector-state";

function control(
  key: WorkspaceSessionLaunchControl["key"],
  label: string,
  defaultValue: string,
): WorkspaceSessionLaunchControl {
  return {
    key,
    label,
    type: "select",
    phase: "live_default",
    createField: null,
    defaultValue,
    values: [
      { value: "medium", label: "Medium", isDefault: defaultValue === "medium" },
      { value: "high", label: "High", isDefault: defaultValue === "high" },
      { value: "off", label: "Off", isDefault: defaultValue === "off" },
      { value: "on", label: "On", isDefault: defaultValue === "on" },
    ],
  };
}

describe("buildLaunchControlDescriptors", () => {
  it("lets model controls override agent controls by key without duplicating composer controls", () => {
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.5" },
      launchAgents: [
        {
          kind: "codex",
          launchControls: [
            control("effort", "Agent Effort", "medium"),
            control("fast_mode", "Agent Fast Mode", "off"),
          ],
          models: [
            {
              id: "gpt-5.5",
              launchControls: [
                control("effort", "Model Effort", "high"),
                control("fast_mode", "Model Fast Mode", "on"),
              ],
            },
          ],
        },
      ],
      preferences: {
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onActiveSessionSelect: null,
    });

    expect(controls.map((candidate) => candidate.key)).toEqual(["effort", "fast_mode"]);
    expect(controls.find((candidate) => candidate.key === "effort")).toMatchObject({
      label: "Model Effort",
      detail: "High",
    });
    expect(controls.find((candidate) => candidate.key === "fast_mode")).toMatchObject({
      label: "Model Fast Mode",
      detail: "On",
    });
  });

  it("uses toggle presentation for launch controls with on/off values", () => {
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.5" },
      launchAgents: [
        {
          kind: "codex",
          launchControls: [
            {
              key: "fast_mode",
              label: "Fast Mode",
              type: "select",
              phase: "live_default",
              createField: null,
              defaultValue: "off",
              values: [
                { value: "off", label: "Off", isDefault: true },
                { value: "on", label: "On", isDefault: false },
              ],
            },
          ],
          models: [{ id: "gpt-5.5" }],
        },
      ],
      preferences: {
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onActiveSessionSelect: null,
    });

    expect(controls).toMatchObject([
      {
        key: "fast_mode",
        kind: "toggle",
        enabledValue: "on",
        disabledValue: "off",
        isEnabled: false,
      },
    ]);
  });
});
