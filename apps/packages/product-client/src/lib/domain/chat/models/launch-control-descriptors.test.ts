import { describe, expect, it, vi } from "vitest";
import type { DesktopAgentLaunchControl } from "#product/lib/domain/agents/cloud-launch-catalog";
import { buildLaunchControlDescriptors } from "#product/lib/domain/chat/models/launch-control-descriptors";

function control(
  key: string,
  label: string,
  defaultValue: string,
  liveConfigId = key,
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
      liveConfigId,
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

describe("buildLaunchControlDescriptors observed vocabulary", () => {
  it("preserves the complete observed control vocabulary without static per-model filtering", () => {
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
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(mode?.key).toBe("mode");
    expect(mode?.options.map((option) => option.value)).toEqual([
      "auto",
      "default",
      "acceptEdits",
      "plan",
    ]);
    const selected = mode?.options.find((option) => option.selected);
    expect(selected).toBeUndefined();
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
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(mode?.options.map((option) => option.value)).toContain("auto");
  });
});

describe("buildLaunchControlDescriptors tuning-control scoping", () => {
  const preferences = {
    defaultLiveSessionControlValuesByAgentKind: {},
  };

  it("keeps every observed control regardless of retired static model matrices", () => {
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "claude", modelId: "sonnet" },
      launchAgents: [
        {
          kind: "claude",
          launchControls: [
            control("effort", "Effort", "medium"),
            control("fast_mode", "Fast Mode", "off"),
          ],
          models: [
            {
              id: "sonnet",
              tuningControlValues: { effort: ["medium", "high"] },
            },
          ],
        },
      ],
      preferences,
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(controls.map((candidate) => candidate.key)).toEqual(["effort", "fast_mode"]);
  });

  it("keeps every observed value and ignores retired preference defaults", () => {
    const [effort] = buildLaunchControlDescriptors({
      selection: { kind: "claude", modelId: "sonnet" },
      launchAgents: [
        {
          kind: "claude",
          launchControls: [control("effort", "Effort", "medium")],
          models: [
            {
              id: "sonnet",
              tuningControlValues: { effort: ["medium", "high"], fast_mode: ["off", "on"] },
            },
          ],
        },
      ],
      preferences: {
        // `off` exists in the agent-level vocabulary but not in the model's
        // scoped effort list — it must not be selected.
        defaultLiveSessionControlValuesByAgentKind: { claude: { effort: "off" } },
      },
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(effort?.options.map((option) => option.value)).toEqual(["medium", "high", "off", "on"]);
    expect(effort?.options.find((option) => option.selected)?.value).toBe("medium");
  });

  it("keeps agent-level tuning controls unscoped when the model has no controls matrix", () => {
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "claude", modelId: "sonnet" },
      launchAgents: [
        {
          kind: "claude",
          launchControls: [
            control("effort", "Effort", "medium"),
            control("fast_mode", "Fast Mode", "off"),
          ],
          models: [{ id: "sonnet", tuningControlValues: null }],
        },
      ],
      preferences,
      pendingConfigChanges: null,
      onSelect: () => {},
    });

    expect(controls.map((candidate) => candidate.key)).toEqual(["effort", "fast_mode"]);
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
            control("effort", "Effort", "medium", "reasoning_effort"),
          ],
          models: [{ id: "gpt-5.5" }],
        },
      ],
      preferences: {
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
      controlKey: "effort",
      rawConfigId: "reasoning_effort",
      value: "high",
    }]);
  });

  it("uses the same mapping logic for an aligned semantic and raw id", () => {
    const onSelect = vi.fn();
    const [effort] = buildLaunchControlDescriptors({
      selection: { kind: "claude", modelId: "claude-fable-5" },
      launchAgents: [{
        kind: "claude",
        launchControls: [control("effort", "Effort", "medium", "effort")],
        models: [{ id: "claude-fable-5" }],
      }],
      preferences: {
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect,
    });

    effort?.onSelect("high");

    expect(effort).toMatchObject({ key: "effort", rawConfigId: "effort" });
    expect(onSelect).toHaveBeenCalledWith("claude", "effort", "effort", "high");
  });

  it("omits a launch control without a live mapping", () => {
    const missingMapping = control("effort", "Effort", "medium", "");

    expect(buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.5" },
      launchAgents: [{
        kind: "codex",
        launchControls: [missingMapping],
        models: [{ id: "gpt-5.5" }],
      }],
      preferences: {
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: null,
      onSelect: vi.fn(),
    })).toEqual([]);
  });

  it("projects a launch-only pending value by semantic key", () => {
    const [effort] = buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.5" },
      launchAgents: [{
        kind: "codex",
        launchControls: [control("effort", "Effort", "medium", "reasoning_effort")],
        models: [{ id: "gpt-5.5" }],
      }],
      preferences: {
        defaultLiveSessionControlValuesByAgentKind: {},
      },
      pendingConfigChanges: {
        effort: {
          rawConfigId: "effort",
          value: "high",
          status: "submitting",
          mutationId: Number.NaN,
        },
      },
      onSelect: vi.fn(),
    });

    expect(effort).toMatchObject({
      key: "effort",
      rawConfigId: "reasoning_effort",
      detail: "High",
      pendingState: "submitting",
    });
  });
});

describe("observed launch control ids", () => {
  // Codex observes `reasoning_effort` / `fast-mode` at launch and reports
  // `effort` / `fast_mode` once live. The composer groups by the descriptor
  // key, so the launch spelling must resolve to the live one or the effort
  // stepper and fast-mode toggle demote to overflow chips on the new-chat
  // composer and re-promote the instant the session goes live.
  it("normalizes codex launch ids onto live control keys", () => {
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.6-sol" },
      launchAgents: [
        {
          kind: "codex",
          models: [{ id: "gpt-5.6-sol" }],
          launchControls: [
            control("reasoning_effort", "Reasoning effort", "medium"),
            control("fast-mode", "Fast mode", "off"),
          ],
        },
      ],
      pendingConfigChanges: null,
      onSelect: vi.fn(),
    });

    expect(controls.map((candidate) => candidate.key)).toEqual([
      "effort",
      "fast_mode",
    ]);
  });

  it("keeps the observed id as the executable raw config id", () => {
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.6-sol" },
      launchAgents: [
        {
          kind: "codex",
          models: [{ id: "gpt-5.6-sol" }],
          launchControls: [
            control("reasoning_effort", "Reasoning effort", "medium"),
            control("fast-mode", "Fast mode", "off"),
          ],
        },
      ],
      pendingConfigChanges: null,
      onSelect: vi.fn(),
    });

    expect(controls.map((candidate) => candidate.rawConfigId)).toEqual([
      "reasoning_effort",
      "fast-mode",
    ]);
  });

  it("preserves unknown observed ids instead of dropping the control", () => {
    const controls = buildLaunchControlDescriptors({
      selection: { kind: "codex", modelId: "gpt-5.6-sol" },
      launchAgents: [
        {
          kind: "codex",
          models: [{ id: "gpt-5.6-sol" }],
          launchControls: [control("verbosity", "Verbosity", "medium")],
        },
      ],
      pendingConfigChanges: null,
      onSelect: vi.fn(),
    });

    expect(controls.map((candidate) => candidate.key)).toEqual(["verbosity"]);
  });
});
