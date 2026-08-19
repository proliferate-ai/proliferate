import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";
import { resolveEffectiveLaunchSelection } from "#product/lib/domain/chat/models/launch-selection-defaults";

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
  it("falls back to the observed default when a stored id no longer resolves", () => {
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
      },
    );

    expect(selection).toEqual({
      kind: "opencode",
      modelId: "opencode/big-pickle",
    });
  });

  it("does not canonicalize a variant-suffixed stored id", () => {
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
      },
    );

    expect(selection).toEqual({
      kind: "codex",
      modelId: "gpt-5.5",
    });
  });

  it("keeps an exact saved id because retired visibility overrides cannot hide observed values", () => {
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
      },
    );

    expect(selection).toEqual({
      kind: "cursor",
      modelId: "cursor/gpt-5.4",
    });
  });
});
