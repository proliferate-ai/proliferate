import { describe, expect, it } from "vitest";
import { buildModelSelectorGroups, unsupportedModelKey } from "#product/lib/domain/chat/models/model-selector-options";

const observedAgent = {
  kind: "claude",
  displayName: "Claude",
  description: null,
  defaultModelId: "fable",
  launchControls: [],
  models: [
    { id: "fable", displayName: "Fable", aliases: [] },
    { id: "unknown-upstream", displayName: "unknown-upstream", aliases: [] },
  ],
};

describe("buildModelSelectorGroups target authority", () => {
  it("keeps every exact target-observed model, including unknown ids", () => {
    const [group] = buildModelSelectorGroups([observedAgent] as never, null, null);
    expect(group?.models.map((model) => model.modelId)).toEqual(["fable", "unknown-upstream"]);
  });

  it("uses only the active session's live model statement once a session exists", () => {
    const [group] = buildModelSelectorGroups(
      [observedAgent] as never,
      { kind: "claude", modelId: "live-only" },
      { kind: "claude", modelId: "live-only" },
      {
        kind: "claude",
        values: [{ value: "live-only", label: "Live only" }],
      },
    );
    expect(group?.models.map((model) => model.modelId)).toEqual(["live-only"]);
  });

  it("marks a refused exact value without dropping the row", () => {
    const [group] = buildModelSelectorGroups(
      [observedAgent] as never,
      null,
      null,
      null,
      new Set([unsupportedModelKey("claude", "unknown-upstream")]),
    );
    expect(group?.models.find((model) => model.modelId === "unknown-upstream")?.isUnsupported).toBe(true);
  });
});
