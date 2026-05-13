import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import {
  buildModelSelectorGroups,
  resolveEffectiveLaunchSelection,
} from "./model-selection";

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

describe("buildModelSelectorGroups", () => {
  it("uses live model controls for the active agent and static rows for other agents", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("sonnet", "Static Sonnet", true),
        ]),
        launchAgent("codex", [
          model("gpt-5.4", "GPT 5.4", true),
        ]),
      ],
      { kind: "claude", modelId: "us.anthropic.claude-opus-4-7-v1:0" },
      { kind: "claude", modelId: "us.anthropic.claude-opus-4-7-v1:0" },
      {
        kind: "claude",
        values: [
          {
            value: "us.anthropic.claude-opus-4-7-v1:0",
            label: "Bedrock Opus 4.7",
          },
          {
            value: "us.anthropic.claude-sonnet-4-6-v1:0",
            label: "Bedrock Sonnet 4.6",
          },
        ],
      },
    );

    expect(groups).toEqual([
      {
        kind: "claude",
        providerDisplayName: "Claude",
        models: [
          {
            kind: "claude",
            modelId: "us.anthropic.claude-opus-4-7-v1:0",
            displayName: "Opus 4.7",
            actionKind: "select",
            isSelected: true,
          },
          {
            kind: "claude",
            modelId: "us.anthropic.claude-sonnet-4-6-v1:0",
            displayName: "Sonnet 4.6",
            actionKind: "update_current_chat",
            isSelected: false,
          },
        ],
      },
      {
        kind: "codex",
        providerDisplayName: "Codex",
        models: [
          {
            kind: "codex",
            modelId: "gpt-5.4",
            displayName: "GPT 5.4",
            actionKind: "open_new_chat",
            isSelected: false,
          },
        ],
      },
    ]);
  });

  it("decorates active Claude rows and hides unselected legacy Claude models", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("sonnet", "Static Sonnet", true),
        ]),
      ],
      { kind: "claude", modelId: "claude-sonnet-4-6" },
      { kind: "claude", modelId: "claude-sonnet-4-6" },
      {
        kind: "claude",
        values: [
          {
            value: "claude-sonnet-4-6",
            label: "Sonnet",
            description: "Balanced default",
          },
          {
            value: "claude-sonnet-4-6-1m",
            label: "Sonnet (1M context)",
          },
          {
            value: "claude-opus-4-1",
            label: "Opus 4.1",
          },
          {
            value: "claude-opus-4-6-1m",
            label: "Opus 4.6 (1M context)",
          },
          {
            value: "custom-legacy-opus",
            label: "Opus 4.1",
          },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "claude",
        modelId: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "claude",
        modelId: "claude-sonnet-4-6-1m",
        displayName: "Sonnet 4.6 (1M context)",
        actionKind: "update_current_chat",
        isSelected: false,
      },
    ]);
  });

  it("keeps a selected hidden Claude value visible with its live label", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("sonnet", "Static Sonnet", true),
        ]),
      ],
      { kind: "claude", modelId: "opus" },
      { kind: "claude", modelId: "opus" },
      {
        kind: "claude",
        values: [
          {
            value: "opus",
            label: "Opus 4.1",
          },
          {
            value: "sonnet",
            label: "Sonnet",
          },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "claude",
        modelId: "opus",
        displayName: "Opus 4.1",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "claude",
        modelId: "sonnet",
        displayName: "Sonnet 4.6",
        actionKind: "update_current_chat",
        isSelected: false,
      },
    ]);
  });

  it("applies visibility preferences to active model controls", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, { defaultOptIn: true }),
            model("cursor/gpt-5.4", "GPT 5.4", false, { defaultOptIn: true }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "cursor/auto" },
      { kind: "cursor", modelId: "cursor/auto" },
      {
        kind: "cursor",
        values: [
          { value: "cursor/auto", label: "Auto" },
          { value: "cursor/gpt-5.4", label: "GPT 5.4" },
        ],
      },
      {
        cursor: {
          "cursor/gpt-5.4": false,
        },
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "cursor/auto",
    ]);
  });
});

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
