import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
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

describe("buildModelSelectorGroups Claude models", () => {
  it("uses live model controls for the active agent and static rows for other agents", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("sonnet", "Static Sonnet", true),
          model("us.anthropic.claude-opus-4-7-v1:0", "Opus 4.7", false),
          model("us.anthropic.claude-sonnet-4-6-v1:0", "Sonnet 4.6 (Bedrock)", false),
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
          model("sonnet[1m]", "Sonnet 4.6 (1M context)", false),
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
        actionKind: "update_current_chat",
        isSelected: false,
      },
    ]);
  });

  it("renders every advertised catalog row with known Claude labels", () => {
    // v2: the catalog menu IS the pre-live menu — advertised rows render
    // as-is; retired models are simply not in the document.
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-sonnet-4-6", "sonnet", true),
          model("haiku", "haiku", false),
          model("opus", "Opus 4.8", false),
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
      {
        modelId: "opus",
        displayName: "Opus 4.8",
      },
    ]);
  });

  it("live-switches catalog-only Claude models when active live controls omit them", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-opus-4-7", "Opus 4.7", false, {
            aliases: ["claude-opus-4-7"],
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
          }),
          model("haiku", "Haiku 4.5", false, {
            aliases: ["claude-haiku-4-5"],
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
        actionKind: "update_current_chat",
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
          }),
          model("us.anthropic.claude-opus-4-8[1m]", "Opus 4.8 (1M context)", false, {
            aliases: ["opus[1m]", "claude-opus-4-8-1m"],
          }),
          model("us.anthropic.claude-opus-4-7", "Opus 4.7", false, {
            aliases: ["claude-opus-4-7"],
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
          }),
          model("haiku", "Haiku 4.5", false, {
            aliases: ["claude-haiku-4-5"],
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
        modelId: "us.anthropic.claude-opus-4-8",
        displayName: "Opus 4.8",
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "claude",
        modelId: "us.anthropic.claude-opus-4-8[1m]",
        displayName: "Opus 4.8 (1M context)",
        actionKind: "select",
        isSelected: true,
      },
      {
        kind: "claude",
        modelId: "us.anthropic.claude-opus-4-7",
        displayName: "Opus 4.7",
        actionKind: "update_current_chat",
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
          }),
          model("opus", "Opus 4.1", false, {
            aliases: ["claude-opus-4-1"],
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
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

  it("maps a selected live opus id onto its catalog row", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          model("us.anthropic.claude-opus-4-8", "Opus 4.8", false, {
            aliases: ["claude-opus-4-8"],
          }),
          model("us.anthropic.claude-opus-4-7", "Opus 4.7", false, {
            aliases: ["claude-opus-4-7"],
          }),
          model("us.anthropic.claude-sonnet-4-6", "Sonnet 4.6", true, {
            aliases: ["sonnet", "claude-sonnet-4-6"],
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
        actionKind: "update_current_chat",
        isSelected: false,
      },
      {
        kind: "claude",
        modelId: "us.anthropic.claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        actionKind: "update_current_chat",
        isSelected: false,
      },
    ]);
  });
});
