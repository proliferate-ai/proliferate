import { describe, expect, it } from "vitest";
import type { WorkspaceSessionLaunchAgent } from "@anyharness/sdk";
import { buildModelSelectorGroups } from "./model-selection";

function launchAgent(kind: string, models: WorkspaceSessionLaunchAgent["models"]): WorkspaceSessionLaunchAgent {
  return {
    kind,
    displayName: kind === "claude" ? "Claude" : "Codex",
    defaultModelId: models[0]?.id ?? null,
    models,
  };
}

describe("buildModelSelectorGroups", () => {
  it("uses live model controls for the active agent and static rows for other agents", () => {
    const groups = buildModelSelectorGroups(
      [
        launchAgent("claude", [
          { id: "sonnet", displayName: "Static Sonnet", isDefault: true },
        ]),
        launchAgent("codex", [
          { id: "gpt-5.4", displayName: "GPT 5.4", isDefault: true },
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
          { id: "sonnet", displayName: "Static Sonnet", isDefault: true },
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
          { id: "sonnet", displayName: "Static Sonnet", isDefault: true },
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
});
