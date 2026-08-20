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

  it("keeps every other observed harness while a session is active", () => {
    const codexAgent = {
      ...observedAgent,
      kind: "codex",
      displayName: "Codex",
      defaultModelId: "gpt-5.6-sol",
      models: [{ id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", aliases: [] }],
    };
    const groups = buildModelSelectorGroups(
      [observedAgent, codexAgent] as never,
      { kind: "claude", modelId: "live-only" },
      { kind: "claude", modelId: "live-only" },
      {
        kind: "claude",
        values: [{ value: "live-only", label: "Live only" }],
      },
    );
    // Negative control against the cutover regression: the active live control
    // must not collapse the picker to the active harness alone.
    expect(groups.map((group) => group.kind)).toEqual(["claude", "codex"]);
    expect(groups[0]?.models.map((model) => model.modelId)).toEqual(["live-only"]);
    expect(groups[1]?.models.map((model) => model.modelId)).toEqual(["gpt-5.6-sol"]);
    expect(groups[1]?.models[0]?.actionKind).toBe("open_new_chat");
  });

  it("synthesizes a group when the live control's harness is unobserved", () => {
    const groups = buildModelSelectorGroups(
      [observedAgent] as never,
      { kind: "grok", modelId: "grok-4.6" },
      { kind: "grok", modelId: "grok-4.6" },
      {
        kind: "grok",
        values: [{ value: "grok-4.6", label: "Grok 4.6" }],
      },
    );
    expect(groups.map((group) => group.kind)).toEqual(["grok", "claude"]);
    expect(groups[0]?.models.map((model) => model.modelId)).toEqual(["grok-4.6"]);
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
