import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import {
  launchSelectionIsAvailable,
  resolveAvailableLaunchSelection,
} from "./launch-selection-defaults";

function launchAgent(
  kind: string,
  models: DesktopAgentLaunchAgent["models"],
): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName: kind === "claude" ? "Claude" : "Codex",
    defaultModelId: models[0]?.id ?? null,
    defaultModeId: null,
    dynamicModels: false,
    modelDisplayPolicy: null,
    promptCapabilities: null,
    models,
    launchControls: [],
  };
}

function model(
  id: string,
  displayName: string,
  isDefault: boolean,
) {
  return {
    id,
    displayName,
    aliases: [],
    status: "active" as const,
    isDefault,
    tags: [],
    launchRemediation: null,
  };
}

describe("launch selection availability", () => {
  it("falls back when the active session agent is not launchable on this target", () => {
    const agents = [
      launchAgent("codex", [model("gpt-5.4", "GPT 5.4", true)]),
    ];

    expect(launchSelectionIsAvailable(agents, {
      kind: "claude",
      modelId: "sonnet",
    })).toBe(false);
    expect(resolveAvailableLaunchSelection(
      agents,
      { kind: "claude", modelId: "sonnet" },
      { kind: "codex", modelId: "gpt-5.4" },
    )).toEqual({
      kind: "codex",
      modelId: "gpt-5.4",
    });
  });

  it("keeps the active session selection when the target can launch it", () => {
    const agents = [
      launchAgent("codex", [model("gpt-5.4", "GPT 5.4", true)]),
    ];

    expect(resolveAvailableLaunchSelection(
      agents,
      { kind: "codex", modelId: "gpt-5.4" },
      { kind: "claude", modelId: "sonnet" },
    )).toEqual({
      kind: "codex",
      modelId: "gpt-5.4",
    });
  });
});
