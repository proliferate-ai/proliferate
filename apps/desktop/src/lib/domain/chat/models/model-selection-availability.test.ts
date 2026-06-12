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
    models,
    launchControls: [],
  };
}

function model(
  id: string,
  displayName: string,
  isDefault: boolean,
  aliases: string[] = [],
) {
  return {
    id,
    displayName,
    aliases,
    status: "active" as const,
    isDefault,
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

  it("returns a canonical launch id for config-shaped Cursor live model values", () => {
    const agents = [
      launchAgent(
        "cursor",
        [
          model("composer-2.5", "Composer 2.5", false),
          model("composer-2.5-fast", "Composer 2.5 Fast", true),
        ],
      ),
    ];

    expect(launchSelectionIsAvailable(agents, {
      kind: "cursor",
      modelId: "composer-2.5[fast=true]",
    })).toBe(true);
    expect(resolveAvailableLaunchSelection(
      agents,
      { kind: "cursor", modelId: "composer-2.5[fast=true]" },
      null,
    )).toEqual({
      kind: "cursor",
      modelId: "composer-2.5-fast",
    });
  });

  it("rejects model ids that do not map to the catalog menu", () => {
    const agents = [
      launchAgent(
        "cursor",
        [model("composer-2.5-fast", "Composer 2.5 Fast", true)],
      ),
    ];

    expect(resolveAvailableLaunchSelection(
      agents,
      { kind: "cursor", modelId: "custom-local-model" },
      null,
    )).toBeNull();
  });

  it("keeps Claude Opus 4.8 base and 1M aliases on separate launch rows", () => {
    const agents = [
      launchAgent("claude", [
        model("us.anthropic.claude-opus-4-8", "Opus 4.8", false, ["claude-opus-4-8"]),
        model(
          "us.anthropic.claude-opus-4-8[1m]",
          "Opus 4.8 (1M context)",
          false,
          ["opus[1m]", "claude-opus-4-8-1m"],
        ),
      ]),
    ];

    expect(resolveAvailableLaunchSelection(
      agents,
      { kind: "claude", modelId: "claude-opus-4-8" },
      null,
    )).toEqual({
      kind: "claude",
      modelId: "us.anthropic.claude-opus-4-8",
    });
    expect(resolveAvailableLaunchSelection(
      agents,
      { kind: "claude", modelId: "opus[1m]" },
      null,
    )).toEqual({
      kind: "claude",
      modelId: "us.anthropic.claude-opus-4-8[1m]",
    });
  });
});
