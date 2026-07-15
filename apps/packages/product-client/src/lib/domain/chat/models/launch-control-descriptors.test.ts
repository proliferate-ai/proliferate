import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchControl } from "#product/lib/domain/agents/cloud-launch-catalog";
import { buildLaunchControlDescriptors } from "#product/lib/domain/chat/models/launch-control-descriptors";

function control(
  key: string,
  label: string,
  defaultValue: string,
): DesktopAgentLaunchControl {
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
    surfaces: {
      start: true,
      session: true,
      automation: false,
      settings: true,
    },
    apply: {
      createField: null,
      liveConfigId: key,
      liveSetter: "runtime_control",
      queueBeforeMaterialized: true,
    },
    missingLiveConfigPolicy: "ignore_default",
    valueSource: "inline",
    queueWhileMaterializing: true,
    mutableAfterMaterialized: true,
  };
}

function modeControl(): DesktopAgentLaunchControl {
  return {
    key: "mode",
    label: "Mode",
    type: "select",
    phase: "create_session",
    createField: "modeId",
    defaultValue: null,
    values: [
      { value: "auto", label: "Auto", isDefault: false },
      { value: "default", label: "Default", isDefault: false },
      { value: "acceptEdits", label: "Accept Edits", isDefault: false },
      { value: "plan", label: "Plan", isDefault: false },
    ],
    surfaces: { start: true, session: true, automation: true, settings: true },
    apply: {
      createField: "modeId",
      liveConfigId: "mode",
      liveSetter: "runtime_control",
      queueBeforeMaterialized: true,
    },
    missingLiveConfigPolicy: "ignore_default",
    valueSource: "inline",
    queueWhileMaterializing: true,
    mutableAfterMaterialized: true,
  };
}

describe("buildLaunchControlDescriptors mode scoping", () => {
  it("scopes the mode control to the selected model's supported modes and never defaults to an unsupported mode", () => {
    // Regression: gateway/bedrock Claude models exclude `auto` from their
    // per-model mode vocabulary. The composer must not offer or default to
    // `auto` for such a model — AnyHarness rejects it at session creation with
    // SESSION_MODE_UNSUPPORTED.
    const [mode] = buildLaunchControlDescriptors({
      selection: { kind: "claude", modelId: "claude-haiku-4-5" },
      launchAgents: [
        {
          kind: "claude",
          launchControls: [modeControl()],
          models: [
            {
              id: "claude-haiku-4-5",
              modeValues: ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"],
            },
          ],
        },
      ],
      preferences: {
        // Even a persisted `auto` preference must not survive onto this model.
        defaultSessionModeByAgentKind: { claude: "auto" },
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(mode?.key).toBe("mode");
    expect(mode?.options.map((option) => option.value)).not.toContain("auto");
    const selected = mode?.options.find((option) => option.selected);
    expect(selected?.value).toBe("default");
  });

  it("keeps the full agent-level mode vocabulary when the model has no per-model modes", () => {
    const [mode] = buildLaunchControlDescriptors({
      selection: { kind: "claude", modelId: "sonnet" },
      launchAgents: [
        {
          kind: "claude",
          launchControls: [modeControl()],
          models: [{ id: "sonnet", modeValues: null }],
        },
      ],
      preferences: {
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(mode?.options.map((option) => option.value)).toContain("auto");
  });
});

describe("buildLaunchControlDescriptors", () => {
  it("builds descriptors from agent launch controls", () => {
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
            },
          ],
        },
      ],
      preferences: {
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(controls.map((candidate) => candidate.key)).toEqual(["effort", "fast_mode"]);
    expect(controls.find((candidate) => candidate.key === "effort")).toMatchObject({
      label: "Agent Effort",
      detail: "Medium",
    });
    expect(controls.find((candidate) => candidate.key === "fast_mode")).toMatchObject({
      label: "Agent Fast Mode",
      detail: "Off",
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
              surfaces: {
                start: true,
                session: true,
                automation: false,
                settings: true,
              },
              apply: {
                createField: null,
                liveConfigId: "fast_mode",
                liveSetter: "runtime_control",
                queueBeforeMaterialized: true,
              },
              missingLiveConfigPolicy: "ignore_default",
              valueSource: "inline",
              queueWhileMaterializing: true,
              mutableAfterMaterialized: true,
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
      onSelect: () => {},
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

  it("passes normalized control key and raw config id to selection handlers", () => {
    const selections: Array<{
      agentKind: string;
      controlKey: string;
      rawConfigId: string;
      value: string;
    }> = [];
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.5" },
      launchAgents: [
        {
          kind: "codex",
          launchControls: [
            control("access_mode", "Mode", "medium"),
          ],
          models: [{ id: "gpt-5.5" }],
        },
      ],
      preferences: {
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect: (agentKind, controlKey, rawConfigId, value) => {
        selections.push({ agentKind, controlKey, rawConfigId, value });
      },
    });

    controls[0]?.onSelect("high");

    expect(selections).toEqual([{
      agentKind: "codex",
      controlKey: "mode",
      rawConfigId: "access_mode",
      value: "high",
    }]);
  });
});
