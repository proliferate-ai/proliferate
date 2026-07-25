import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import { buildModelSelectorGroups } from "./model-selector-options";

describe("buildModelSelectorGroups Codex models", () => {
  it("prefers the curated catalog label over the raw live Codex label", () => {
    const agent: DesktopAgentLaunchAgent = {
      kind: "codex",
      displayName: "Codex",
      defaultModelId: "gpt-5.6-sol",
      launchControls: [],
      models: [{
        id: "gpt-5.6-sol",
        displayName: "5.6 Sol",
        aliases: [],
        status: "active",
        isDefault: true,
      }],
    };

    const groups = buildModelSelectorGroups(
      [agent],
      { kind: "codex", modelId: "gpt-5.6-sol" },
      { kind: "codex", modelId: "gpt-5.6-sol" },
      {
        kind: "codex",
        values: [{ value: "gpt-5.6-sol", label: "GPT-5.6-Sol" }],
      },
    );

    expect(groups[0]?.models[0]).toMatchObject({
      modelId: "gpt-5.6-sol",
      displayName: "5.6 Sol",
      isSelected: true,
    });
  });
});
