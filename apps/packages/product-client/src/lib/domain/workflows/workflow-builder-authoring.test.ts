import { describe, expect, it } from "vitest";
import { getBundledDesktopAgentLaunchCatalog } from "#product/lib/domain/agents/bundled-agent-catalog";
import { buildDesktopLaunchModelRegistries } from "#product/lib/domain/agents/cloud-launch-catalog";
import {
  workflowBuilderHarnessOptions,
  workflowBuilderModelOptions,
} from "#product/lib/domain/workflows/workflow-builder-authoring";

describe("workflowBuilderHarnessOptions", () => {
  it("reads the real catalog projection, not the raw catalog document", () => {
    // The live source: the same projection `useCloudAgentCatalog` serves. If
    // the builder were pointed at the raw `agent.session.models` shape gen-1's
    // helpers expect, this would come back empty.
    const registries = buildDesktopLaunchModelRegistries(
      getBundledDesktopAgentLaunchCatalog().agents,
    );
    const harnesses = workflowBuilderHarnessOptions(registries);

    expect(harnesses.length).toBeGreaterThan(0);
    expect(harnesses.every((harness) => harness.models.length > 0)).toBe(true);
    expect(harnesses.map((harness) => harness.agentKind)).toContain("claude");
    expect(workflowBuilderModelOptions(harnesses, "claude").length).toBeGreaterThan(0);
  });

  it("drops a harness that offers no model", () => {
    const harnesses = workflowBuilderHarnessOptions([
      { kind: "empty", displayName: "Empty", defaultModelId: null, models: [] },
      {
        kind: "claude",
        displayName: "Claude",
        defaultModelId: "sonnet",
        models: [{ id: "sonnet", displayName: "Sonnet", isDefault: true }],
      },
    ]);

    expect(harnesses.map((harness) => harness.agentKind)).toEqual(["claude"]);
  });

  it("answers with no models for an unknown or unset harness", () => {
    const harnesses = workflowBuilderHarnessOptions([{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: null,
      models: [{ id: "sonnet", displayName: "Sonnet", isDefault: true }],
    }]);

    expect(workflowBuilderModelOptions(harnesses, null)).toEqual([]);
    expect(workflowBuilderModelOptions(harnesses, "codex")).toEqual([]);
  });
});
