import { describe, expect, it, vi } from "vitest";
import {
  buildCloudLaunchComposerControls,
  buildLaunchRunConfigControlValues,
  resolveCloudLaunchSelection,
} from "./composer-controls";

describe("cloud launch controls", () => {
  it("renders every exact observed control and model, preserving both Codex controls", () => {
    const controls = buildCloudLaunchComposerControls({
      launchOptions: response() as never,
      selection: { agentKind: "codex", modelId: null, controlValues: {} },
      onAgentModelSelect: vi.fn(),
      onControlSelect: vi.fn(),
    });
    expect(controls.map((control) => control.key)).toEqual([
      "collaboration_mode", "mode", "model",
    ]);
  });

  it("initializes the complete raw selection from observed defaults", () => {
    expect(resolveCloudLaunchSelection({
      launchOptions: response() as never,
      selection: { agentKind: "codex", modelId: null, controlValues: {} },
    })).toEqual({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      controlValues: { collaboration_mode: "plan", mode: "agent-full-access" },
    });
  });

  it("stores exact selected control values for background execution", () => {
    expect(buildLaunchRunConfigControlValues({
      launchOptions: response() as never,
      selection: {
        agentKind: "codex",
        modelId: "gpt-5.6-codex",
        controlValues: { collaboration_mode: "default", mode: "agent" },
      },
    })).toEqual({ collaboration_mode: "default", mode: "agent" });
  });

  it("uses the selected model's exact controls and drops values from the previous model", () => {
    const launchOptions = modelScopedResponse();
    const selection = {
      agentKind: "claude",
      modelId: "claude-fable-5[1m]",
      controlValues: { mode: "default", effort: "ultra", fast: "on" },
    };

    const controls = buildCloudLaunchComposerControls({
      launchOptions: launchOptions as never,
      selection,
      onAgentModelSelect: vi.fn(),
      onControlSelect: vi.fn(),
    });

    expect(controls.map((control) => control.key)).toEqual(["mode", "effort", "model"]);
    expect(resolveCloudLaunchSelection({
      launchOptions: launchOptions as never,
      selection,
    })).toEqual({
      agentKind: "claude",
      modelId: "claude-fable-5[1m]",
      controlValues: { mode: "default", effort: "high" },
    });
  });

  it("honors an exact empty model-scoped control set instead of falling back", () => {
    const launchOptions = modelScopedResponse();
    launchOptions.options.modelControls = [{
      modelId: "claude-fable-5[1m]",
      controls: [],
      defaultControlValues: {},
    }];

    expect(buildCloudLaunchComposerControls({
      launchOptions: launchOptions as never,
      selection: {
        agentKind: "claude",
        modelId: "claude-fable-5[1m]",
        controlValues: { fast: "off" },
      },
      onAgentModelSelect: vi.fn(),
      onControlSelect: vi.fn(),
    }).map((control) => control.key)).toEqual(["model"]);
  });
});

function response() {
  return {
    harnessKind: "codex", basisRevision: "basis-1", revision: 1, state: "observed",
    options: {
      models: [{ id: "gpt-5.6-codex", observedName: "GPT-5.6 Codex", observedDescription: null }],
      controls: [
        { id: "collaboration_mode", observedLabel: "Mode", observedDescription: null, values: [
          { value: "default", observedLabel: "Default", observedDescription: null },
          { value: "plan", observedLabel: "Plan", observedDescription: null },
        ] },
        { id: "mode", observedLabel: "Access", observedDescription: null, values: [
          { value: "read-only", observedLabel: "Read only", observedDescription: null },
          { value: "agent", observedLabel: "Agent", observedDescription: null },
          { value: "agent-full-access", observedLabel: "Full access", observedDescription: null },
        ] },
      ],
      defaults: { modelId: "gpt-5.6-codex", controlValues: {
        collaboration_mode: "plan", mode: "agent-full-access",
      } },
    },
  };
}

function modelScopedResponse() {
  const mode = {
    id: "mode", observedLabel: "Mode", observedDescription: null, values: [
      { value: "default", observedLabel: "Default", observedDescription: null },
      { value: "plan", observedLabel: "Plan", observedDescription: null },
    ],
  };
  const effort = {
    id: "effort", observedLabel: "Effort", observedDescription: null, values: [
      { value: "high", observedLabel: "High", observedDescription: null },
      { value: "max", observedLabel: "Max", observedDescription: null },
    ],
  };
  const fast = {
    id: "fast", observedLabel: "Fast mode", observedDescription: null, values: [
      { value: "on", observedLabel: "On", observedDescription: null },
      { value: "off", observedLabel: "Off", observedDescription: null },
    ],
  };
  return {
    harnessKind: "claude", basisRevision: "basis-2", revision: 2, state: "observed",
    options: {
      models: [
        { id: "opus[1m]", observedName: "Opus", observedDescription: null },
        { id: "claude-fable-5[1m]", observedName: "Fable 5", observedDescription: null },
      ],
      controls: [mode, effort, fast],
      defaults: {
        modelId: "opus[1m]",
        controlValues: { mode: "default", effort: "high", fast: "off" },
      },
      modelControls: [
        {
          modelId: "opus[1m]",
          controls: [mode, effort, fast],
          defaultControlValues: { mode: "default", effort: "high", fast: "off" },
        },
        {
          modelId: "claude-fable-5[1m]",
          controls: [mode, effort],
          defaultControlValues: { mode: "default", effort: "high" },
        },
      ],
    },
  };
}
