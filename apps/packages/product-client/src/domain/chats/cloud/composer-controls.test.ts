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
