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
    defaultModeId: null,
    dynamicModels: false,
    modelDisplayPolicy: null,
    promptCapabilities: null,
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
    tags: [],
    launchRemediation: null,
    ...overrides,
  };
}

describe("resolveEffectiveLaunchSelection", () => {
  it("keeps a preferred OpenCode dynamic model before live ACP model truth is available", () => {
    const selection = resolveEffectiveLaunchSelection(
      [
        launchAgent(
          "opencode",
          [model("opencode/big-pickle", "OpenCode Zen/Big Pickle", true)],
          {
            displayName: "OpenCode",
            dynamicModels: true,
            modelDisplayPolicy: {
              defaultVisibleModelIds: ["opencode/big-pickle"],
              allowUserVisibleModelSelection: true,
              moreModelsSource: "lastKnownLiveSnapshot",
            },
          },
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
      modelId: "anthropic/claude-sonnet-4-6",
    });
  });

  it("does not restore a hidden known model through dynamic fallback", () => {
    const selection = resolveEffectiveLaunchSelection(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true),
            model("cursor/gpt-5.4", "GPT 5.4", false, { defaultOptIn: true }),
          ],
          {
            displayName: "Cursor",
            dynamicModels: true,
            modelDisplayPolicy: {
              defaultVisibleModelIds: ["cursor/auto", "cursor/gpt-5.4"],
              allowUserVisibleModelSelection: true,
              moreModelsSource: "lastKnownLiveSnapshot",
            },
          },
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
