import { describe, expect, it } from "vitest";
import {
  workflowBuilderControlOptions,
  workflowBuilderControlValues,
  workflowBuilderHarnessOptions,
  workflowBuilderModelOptions,
} from "#product/lib/domain/workflows/workflow-builder-authoring";

const observed = {
  harnessKind: "claude",
  options: {
    models: [
      { id: "fable", observedName: "Fable", observedDescription: null },
      { id: "unknown-upstream", observedName: null, observedDescription: null },
    ],
    controls: [], defaults: { modelId: "fable", controlValues: {} },
  },
};

describe("workflowBuilderHarnessOptions", () => {
  it("preserves target-observed ids without catalog enrichment or filtering", () => {
    const harnesses = workflowBuilderHarnessOptions([observed as never]);
    expect(harnesses).toEqual([{
      agentKind: "claude",
      label: "claude",
      defaultModelId: "fable",
      models: [
        { id: "fable", label: "Fable", controls: null },
        { id: "unknown-upstream", label: "unknown-upstream", controls: null },
      ],
      controls: [],
    }]);
  });

  it("uses selected-model controls and falls back to harness controls without a scope", () => {
    const mode = observedControl("mode", ["default", "plan"]);
    const fast = observedControl("fast", ["off", "on"]);
    const harnesses = workflowBuilderHarnessOptions([{
      harnessKind: "claude",
      options: {
        models: [
          { id: "opus", observedName: "Opus", observedDescription: null },
          { id: "fable", observedName: "Fable", observedDescription: null },
          { id: "legacy", observedName: "Legacy", observedDescription: null },
        ],
        controls: [mode, fast],
        defaults: { modelId: "fable", controlValues: { mode: "default", fast: "off" } },
        modelControls: [
          {
            modelId: "opus",
            controls: [mode, fast],
            defaultControlValues: { mode: "default", fast: "off" },
          },
          {
            modelId: "fable",
            controls: [mode],
            defaultControlValues: { mode: "default" },
          },
        ],
      },
    } as never]);

    expect(workflowBuilderControlOptions(harnesses, "claude", "fable")
      .map((control) => control.key)).toEqual(["mode"]);
    expect(workflowBuilderControlOptions(harnesses, "claude", "opus")
      .map((control) => control.key)).toEqual(["mode", "fast"]);
    expect(workflowBuilderControlOptions(harnesses, "claude", "legacy")
      .map((control) => control.key)).toEqual(["mode", "fast"]);
    expect(workflowBuilderControlOptions(harnesses, "claude", "")
      .map((control) => control.key)).toEqual(["mode"]);
    expect(workflowBuilderControlValues(
      workflowBuilderControlOptions(harnesses, "claude", "fable"),
      { mode: "plan", fast: "on" },
    )).toEqual({ mode: "plan" });
  });

  it("answers with no models for an unknown or unset harness", () => {
    const harnesses = workflowBuilderHarnessOptions([observed as never]);
    expect(workflowBuilderModelOptions(harnesses, null)).toEqual([]);
    expect(workflowBuilderModelOptions(harnesses, "codex")).toEqual([]);
  });
});

function observedControl(id: string, values: string[]) {
  return {
    id,
    observedLabel: id,
    observedDescription: null,
    values: values.map((value) => ({
      value,
      observedLabel: value,
      observedDescription: null,
    })),
  };
}
