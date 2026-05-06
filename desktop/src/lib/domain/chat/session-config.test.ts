import { describe, expect, it } from "vitest";
import type { ModelRegistry, WorkspaceSessionLaunchAgent } from "@anyharness/sdk";
import { mergeLaunchAgentsWithRegistries } from "./session-config";

function launchAgent(overrides: Partial<WorkspaceSessionLaunchAgent> & { kind: string }): WorkspaceSessionLaunchAgent {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? null,
    models: overrides.models ?? [],
  };
}

function registry(overrides: Partial<ModelRegistry> & { kind: string }): ModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? null,
    models: overrides.models ?? [],
  };
}

describe("mergeLaunchAgentsWithRegistries", () => {
  it("preserves launch rows and decorates exact registry matches", () => {
    const merged = mergeLaunchAgentsWithRegistries(
      [
        launchAgent({
          kind: "codex",
          models: [
            { id: "gpt-5.4", displayName: "Live GPT 5.4", isDefault: true },
          ],
        }),
      ],
      [
        registry({
          kind: "codex",
          displayName: "Codex",
          defaultModelId: "gpt-5.4",
          models: [
            {
              id: "gpt-5.5",
              displayName: "GPT 5.5",
              isDefault: false,
              status: "active",
            },
            {
              id: "gpt-5.4",
              displayName: "GPT 5.4",
              isDefault: true,
              status: "active",
            },
          ],
        }),
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.models).toEqual([
      { id: "gpt-5.4", displayName: "GPT 5.4", isDefault: true },
    ]);
    expect(merged[0]?.displayName).toBe("Codex");
  });

  it("preserves launch model session default controls while decorating labels", () => {
    const merged = mergeLaunchAgentsWithRegistries(
      [
        launchAgent({
          kind: "codex",
          models: [
            {
              id: "gpt-5.4",
              displayName: "Live GPT 5.4",
              isDefault: true,
              sessionDefaultControls: [{
                key: "effort",
                label: "Effort",
                defaultValue: "high",
                values: [{
                  value: "high",
                  label: "High",
                  isDefault: true,
                }],
              }],
            },
          ],
        }),
      ],
      [
        registry({
          kind: "codex",
          displayName: "Codex",
          defaultModelId: "gpt-5.4",
          models: [{
            id: "gpt-5.4",
            displayName: "GPT 5.4",
            isDefault: true,
            status: "active",
          }],
        }),
      ],
    );

    expect(merged[0]?.models[0]).toMatchObject({
      id: "gpt-5.4",
      displayName: "GPT 5.4",
      sessionDefaultControls: [{
        key: "effort",
        defaultValue: "high",
      }],
    });
  });

  it("decorates alias matches while preserving live ids", () => {
    const merged = mergeLaunchAgentsWithRegistries(
      [
        launchAgent({
          kind: "claude",
          models: [
            {
              id: "claude-opus-4-7",
              displayName: "Live Opus",
              isDefault: false,
            },
            {
              id: "us.anthropic.claude-opus-4-7-v1:0",
              displayName: "Bedrock Opus 4.7",
              isDefault: true,
            },
          ],
        }),
      ],
      [
        registry({
          kind: "claude",
          displayName: "Claude",
          defaultModelId: "opus[1m]",
          models: [
            {
              id: "opus[1m]",
              displayName: "Opus 4.7",
              isDefault: true,
              status: "active",
              aliases: ["claude-opus-4-7"],
            },
          ],
        }),
      ],
    );

    expect(merged[0]?.defaultModelId).toBe("claude-opus-4-7");
    expect(merged[0]?.models).toEqual([
      { id: "claude-opus-4-7", displayName: "Opus 4.7", isDefault: true },
      {
        id: "us.anthropic.claude-opus-4-7-v1:0",
        displayName: "Bedrock Opus 4.7",
        isDefault: false,
      },
    ]);
  });

  it("falls back to runtime defaults when no registry default matches live rows", () => {
    const merged = mergeLaunchAgentsWithRegistries(
      [
        launchAgent({
          kind: "claude",
          defaultModelId: "us.anthropic.claude-sonnet-4-6-v1:0",
          models: [
            {
              id: "us.anthropic.claude-sonnet-4-6-v1:0",
              displayName: "Bedrock Sonnet 4.6",
              isDefault: false,
            },
          ],
        }),
      ],
      [
        registry({
          kind: "claude",
          displayName: "Claude",
          defaultModelId: "sonnet",
          models: [
            {
              id: "sonnet",
              displayName: "Sonnet 4.6",
              isDefault: true,
              status: "active",
              aliases: ["claude-sonnet-4-6"],
            },
          ],
        }),
      ],
    );

    expect(merged[0]?.defaultModelId).toBe("us.anthropic.claude-sonnet-4-6-v1:0");
    expect(merged[0]?.models).toEqual([
      {
        id: "us.anthropic.claude-sonnet-4-6-v1:0",
        displayName: "Bedrock Sonnet 4.6",
        isDefault: true,
      },
    ]);
  });
});
