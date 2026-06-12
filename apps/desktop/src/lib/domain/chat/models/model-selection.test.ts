import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import { resolveEffectiveLaunchSelection } from "./launch-selection-defaults";

function launchAgent(
  kind: string,
  models: DesktopAgentLaunchAgent["models"],
  overrides: Partial<DesktopAgentLaunchAgent> = {},
): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName: kind === "claude" ? "Claude" : "Codex",
    defaultModelId: models[0]?.id ?? null,
    models,
    launchControls: [],
    ...overrides,
  };
}

function model(
  id: string,
  displayName: string,
  isDefault: boolean,
  overrides: Partial<DesktopAgentLaunchAgent["models"][number]> = {},
) {
  return {
    id,
    displayName,
    aliases: [],
    status: "active" as const,
    isDefault,
    ...overrides,
  };
}

describe("resolveEffectiveLaunchSelection", () => {
  it("falls back to the catalog default when a stored dynamic id no longer resolves", () => {
    const selection = resolveEffectiveLaunchSelection(
      [
        launchAgent(
          "opencode",
          [model("opencode/big-pickle", "OpenCode Zen/Big Pickle", true)],
          { displayName: "OpenCode" },
        ),
      ],
      {
        defaultChatAgentKind: "opencode",
        defaultChatModelIdByAgentKind: {
          opencode: "anthropic/claude-sonnet-4-6",
        },
        chatModelVisibilityOverridesByAgentKind: {},
      },
    );

    expect(selection).toEqual({
      kind: "opencode",
      modelId: "opencode/big-pickle",
    });
  });

  it("resolves a variant-suffixed stored id onto its catalog base model", () => {
    const selection = resolveEffectiveLaunchSelection(
      [
        launchAgent(
          "codex",
          [
            model("gpt-5.5", "GPT-5.5", true),
            model("gpt-5.5-codex", "GPT-5.5 Codex", false),
          ],
        ),
      ],
      {
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {
          codex: "gpt-5.5-codex/high",
        },
        chatModelVisibilityOverridesByAgentKind: {},
      },
    );

    expect(selection).toEqual({
      kind: "codex",
      modelId: "gpt-5.5-codex",
    });
  });

  it("does not restore a hidden known model through saved-id fallback", () => {
    const selection = resolveEffectiveLaunchSelection(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true),
            model("cursor/gpt-5.4", "GPT 5.4", false),
          ],
          { displayName: "Cursor" },
        ),
      ],
      {
        defaultChatAgentKind: "cursor",
        defaultChatModelIdByAgentKind: {
          cursor: "cursor/gpt-5.4",
        },
        chatModelVisibilityOverridesByAgentKind: {
          cursor: {
            "cursor/gpt-5.4": false,
          },
        },
      },
    );

    expect(selection).toEqual({
      kind: "cursor",
      modelId: "cursor/auto",
    });
  });
});
