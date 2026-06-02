import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import { resolveEffectiveLaunchSelection } from "./launch-selection-defaults";
import {
  buildModelSelectorGroups,
} from "./model-selector-options";

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

  it("maps a selected legacy Claude Opus live value to the current catalog row", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-opus-4-8", "Opus 4.8", false, {
            aliases: ["claude-opus-4-8"],
            defaultOptIn: true,
          }),
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
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "claude",
        modelId: "opus",
        displayName: "Opus 4.8",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "claude",
        modelId: "sonnet",
        displayName: "Sonnet 4.6",
        actionKind: "open_new_chat",
        isSelected: false,
      },
    ]);
  });

  it("uses known Claude labels for static catalog rows and hides legacy Opus", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-sonnet-4-6", "sonnet", true),
          model("haiku", "haiku", false, { defaultOptIn: true }),
          model("opus", "Opus 4.1", false, { defaultOptIn: true }),
        ]),
      ],
      { kind: "claude", modelId: "us.anthropic.claude-sonnet-4-6" },
      { kind: "claude", modelId: "us.anthropic.claude-sonnet-4-6" },
      null,
    );

    expect(groups[0]?.models.map((model) => ({
      modelId: model.modelId,
      displayName: model.displayName,
    }))).toEqual([
      {
        modelId: "us.anthropic.claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
      },
      {
        modelId: "haiku",
        displayName: "Haiku 4.5",
      },
    ]);
  });

  it("shows catalog-only Claude models as new-chat actions when active live controls omit them", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-opus-4-7", "Opus 4.7", false, {
            aliases: ["claude-opus-4-7"],
            defaultOptIn: true,
          }),
          model("opus", "Opus 4.1", false, {
            aliases: ["claude-opus-4-1"],
            defaultOptIn: false,
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
            defaultOptIn: true,
          }),
          model("haiku", "Haiku 4.5", false, {
            aliases: ["claude-haiku-4-5"],
            defaultOptIn: true,
          }),
        ]),
      ],
      { kind: "claude", modelId: "sonnet" },
      { kind: "claude", modelId: "sonnet" },
      {
        kind: "claude",
        values: [
          {
            value: "sonnet",
            label: "Sonnet",
            description: "Sonnet 4.6 - Best for everyday tasks",
          },
          {
            value: "haiku",
            label: "Haiku",
            description: "Haiku 4.5 - Fastest for quick answers",
          },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "claude",
        modelId: "sonnet",
        displayName: "Sonnet 4.6",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "claude",
        modelId: "haiku",
        displayName: "Haiku 4.5",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "claude",
        modelId: "us.anthropic.claude-opus-4-7",
        displayName: "Opus 4.7",
        actionKind: "open_new_chat",
        isSelected: false,
      },
    ]);
  });

  it("recognizes the current Claude Opus live alias as the selected catalog row", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-opus-4-8", "Opus 4.8", false, {
            aliases: ["claude-opus-4-8"],
            defaultOptIn: true,
          }),
          model("us.anthropic.claude-opus-4-7", "Opus 4.7", false, {
            aliases: ["claude-opus-4-7"],
            defaultOptIn: true,
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
            defaultOptIn: true,
          }),
          model("haiku", "Haiku 4.5", false, {
            aliases: ["claude-haiku-4-5"],
            defaultOptIn: true,
          }),
        ]),
      ],
      { kind: "claude", modelId: "opus[1m]" },
      { kind: "claude", modelId: "opus[1m]" },
      {
        kind: "claude",
        values: [
          {
            value: "sonnet",
            label: "Sonnet",
            description: "Sonnet 4.6 - Best for everyday tasks",
          },
          {
            value: "haiku",
            label: "Haiku",
            description: "Haiku 4.5 - Fastest for quick answers",
          },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "claude",
        modelId: "sonnet",
        displayName: "Sonnet 4.6",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "claude",
        modelId: "haiku",
        displayName: "Haiku 4.5",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "claude",
        modelId: "opus[1m]",
        displayName: "Opus 4.8",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "claude",
        modelId: "us.anthropic.claude-opus-4-7",
        displayName: "Opus 4.7",
        actionKind: "open_new_chat",
        isSelected: false,
      },
    ]);
  });

  it("does not double-select when the live control carries opus and the catalog has both the legacy row and Opus 4.8", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-opus-4-8", "Opus 4.8", false, {
            aliases: ["claude-opus-4-8"],
            defaultOptIn: true,
          }),
          model("opus", "Opus 4.1", false, {
            aliases: ["claude-opus-4-1"],
            defaultOptIn: false,
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
            defaultOptIn: true,
          }),
        ]),
      ],
      { kind: "claude", modelId: "opus" },
      { kind: "claude", modelId: "opus" },
      {
        kind: "claude",
        values: [
          { value: "opus", label: "Opus 4.1" },
          { value: "sonnet", label: "Sonnet" },
        ],
      },
    );

    const selectedModels = groups[0]?.models.filter((m) => m.isSelected) ?? [];
    expect(selectedModels).toHaveLength(1);
    expect(selectedModels[0]?.modelId).toBe("opus");
  });

  it("keeps the legacy Claude Opus catalog row hidden when the active live id is opus", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-opus-4-8", "Opus 4.8", false, {
            aliases: ["claude-opus-4-8"],
            defaultOptIn: true,
          }),
          model("us.anthropic.claude-opus-4-7", "Opus 4.7", false, {
            aliases: ["claude-opus-4-7"],
            defaultOptIn: true,
          }),
          model("opus", "Opus 4.1", false, {
            aliases: ["claude-opus-4-1"],
            defaultOptIn: false,
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
            defaultOptIn: true,
          }),
        ]),
      ],
      { kind: "claude", modelId: "opus" },
      { kind: "claude", modelId: "opus" },
      null,
      {
        claude: {
          opus: true,
        },
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "claude",
        modelId: "opus",
        displayName: "Opus 4.8",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "claude",
        modelId: "us.anthropic.claude-opus-4-7",
        displayName: "Opus 4.7",
        actionKind: "open_new_chat",
        isSelected: false,
      },
      {
        kind: "claude",
        modelId: "us.anthropic.claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        actionKind: "open_new_chat",
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

  it("applies visibility preferences to active model controls by alias", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
              defaultOptIn: true,
            }),
            model("cursor/gpt-5.4", "GPT 5.4", false, {
              aliases: ["gpt-5.4"],
              defaultOptIn: true,
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "auto" },
      { kind: "cursor", modelId: "auto" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
        ],
      },
      {
        cursor: {
          "cursor/gpt-5.4": false,
        },
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "auto",
    ]);
  });

  it("keeps canonical selected models visible when live controls use aliases", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
              defaultOptIn: true,
            }),
            model("cursor/gpt-5.4", "GPT 5.4", false, {
              aliases: ["gpt-5.4"],
              defaultOptIn: true,
            }),
          ],
          {
            displayName: "Cursor",
          },
        ),
      ],
      { kind: "cursor", modelId: "cursor/gpt-5.4" },
      { kind: "cursor", modelId: "cursor/gpt-5.4" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
        ],
      },
      {
        cursor: {
          "cursor/gpt-5.4": false,
        },
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "cursor",
        modelId: "auto",
        displayName: "Auto",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "cursor",
        modelId: "gpt-5.4",
        displayName: "GPT 5.4",
        actionKind: "select",
        isSelected: true,
      },
    ]);
  });

  it("hides unknown live control models for dynamic agents unless selected", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
              defaultOptIn: true,
            }),
          ],
          {
            displayName: "Cursor",
            dynamicModels: true,
            modelDisplayPolicy: {
              defaultVisibleModelIds: ["cursor/auto"],
              allowUserVisibleModelSelection: true,
              moreModelsSource: "lastKnownLiveSnapshot",
            },
          },
        ),
      ],
      { kind: "cursor", modelId: "auto" },
      { kind: "cursor", modelId: "auto" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
          { value: "grok-4.3", label: "Grok 4.3" },
        ],
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "auto",
    ]);
  });

  it("keeps selected unknown live control models visible for dynamic agents", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("cursor/auto", "Auto", true, {
              aliases: ["auto"],
              defaultOptIn: true,
            }),
          ],
          {
            displayName: "Cursor",
            dynamicModels: true,
            modelDisplayPolicy: {
              defaultVisibleModelIds: ["cursor/auto"],
              allowUserVisibleModelSelection: true,
              moreModelsSource: "lastKnownLiveSnapshot",
            },
          },
        ),
      ],
      { kind: "cursor", modelId: "gpt-5.4" },
      { kind: "cursor", modelId: "gpt-5.4" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "gpt-5.4", label: "GPT 5.4" },
          { value: "grok-4.3", label: "Grok 4.3" },
        ],
      },
    );

    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "auto",
      "gpt-5.4",
    ]);
  });

  it("dedupes Cursor live control rows against catalog models with human labels", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("auto", "Auto", true, { defaultOptIn: true }),
            model("composer-2.5", "Composer 2.5", false, {
              aliases: ["composer-2"],
              defaultOptIn: true,
            }),
          ],
          {
            displayName: "Cursor",
            dynamicModels: true,
            modelDisplayPolicy: {
              defaultVisibleModelIds: ["auto", "composer-2.5"],
              allowUserVisibleModelSelection: true,
              moreModelsSource: "lastKnownLiveSnapshot",
            },
          },
        ),
      ],
      { kind: "cursor", modelId: "composer-2.5" },
      { kind: "cursor", modelId: "composer-2.5" },
      {
        kind: "cursor",
        values: [
          { value: "auto", label: "Auto" },
          { value: "composer-2.5", label: "composer-2.5" },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "cursor",
        modelId: "auto",
        displayName: "Auto",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "cursor",
        modelId: "composer-2.5",
        displayName: "Composer 2.5",
        actionKind: "select",
        isSelected: true,
      },
    ]);
  });

  it("canonicalizes Cursor config-shaped live model ids before display and dedupe", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "cursor",
          [
            model("auto", "Auto", true, {
              aliases: ["default[]"],
              defaultOptIn: true,
            }),
            model("composer-2.5", "Composer 2.5", false, {
              defaultOptIn: true,
            }),
            model("composer-2.5-fast", "Composer 2.5 Fast", false, {
              aliases: ["composer-2[fast=true]"],
              defaultOptIn: true,
            }),
          ],
          {
            displayName: "Cursor",
            dynamicModels: true,
            modelDisplayPolicy: {
              defaultVisibleModelIds: ["auto", "composer-2.5", "composer-2.5-fast"],
              allowUserVisibleModelSelection: true,
              moreModelsSource: "lastKnownLiveSnapshot",
            },
          },
        ),
      ],
      { kind: "cursor", modelId: "composer-2.5[fast=true]" },
      { kind: "cursor", modelId: "composer-2.5[fast=true]" },
      {
        kind: "cursor",
        values: [
          { value: "default[]", label: "Auto" },
          { value: "composer-2.5[fast=true]", label: "composer-2.5" },
        ],
      },
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "cursor",
        modelId: "default[]",
        displayName: "Auto",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "cursor",
        modelId: "composer-2.5[fast=true]",
        displayName: "Composer 2.5 Fast",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "cursor",
        modelId: "composer-2.5",
        displayName: "Composer 2.5",
        actionKind: "open_new_chat",
        isSelected: false,
      },
    ]);
  });

  it("matches Gemini preview runtime ids to catalog rows", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent(
          "gemini",
          [
            model("auto-gemini-3", "Auto (Gemini 3)", true, {
              defaultOptIn: true,
            }),
            model("gemini-3-flash", "Gemini 3 Flash", false, {
              defaultOptIn: true,
            }),
            model("gemini-3-pro", "Gemini 3 Pro", false, {
              defaultOptIn: true,
            }),
          ],
          {
            displayName: "Gemini",
          },
        ),
      ],
      { kind: "gemini", modelId: "gemini-3-flash-preview" },
      { kind: "gemini", modelId: "gemini-3-flash-preview" },
      null,
    );

    expect(groups[0]?.models).toEqual([
      {
        kind: "gemini",
        modelId: "auto-gemini-3",
        displayName: "Auto (Gemini 3)",
        actionKind: "open_new_chat",
        isSelected: false,
      },
      {
        kind: "gemini",
        modelId: "gemini-3-flash",
        displayName: "Gemini 3 Flash",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "gemini",
        modelId: "gemini-3-pro",
        displayName: "Gemini 3 Pro",
        actionKind: "open_new_chat",
        isSelected: false,
      },
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
