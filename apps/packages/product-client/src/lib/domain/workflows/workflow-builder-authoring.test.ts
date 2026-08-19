import { describe, expect, it } from "vitest";
import {
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
      models: [
        { id: "fable", label: "Fable" },
        { id: "unknown-upstream", label: "unknown-upstream" },
      ],
      controls: [],
    }]);
  });

  it("answers with no models for an unknown or unset harness", () => {
    const harnesses = workflowBuilderHarnessOptions([observed as never]);
    expect(workflowBuilderModelOptions(harnesses, null)).toEqual([]);
    expect(workflowBuilderModelOptions(harnesses, "codex")).toEqual([]);
  });
});
