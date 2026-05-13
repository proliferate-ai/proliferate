import { describe, expect, it } from "vitest";
import type {
  DesktopLaunchModelRegistry as ModelRegistry,
  RuntimeAgentLaunchOptions,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { mergeRuntimeLaunchOptionsIntoModelRegistries } from "./model-registries";

describe("mergeRuntimeLaunchOptionsIntoModelRegistries", () => {
  it("preserves catalog aliases when runtime launch options are merged", () => {
    const cloudRegistries: ModelRegistry[] = [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "sonnet",
      models: [{
        id: "sonnet",
        displayName: "Sonnet",
        aliases: ["claude-sonnet-4-6"],
        isDefault: true,
      }],
    }];
    const runtimeAgents: RuntimeAgentLaunchOptions[] = [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "sonnet",
      models: [{
        id: "sonnet",
        displayName: "Sonnet",
        isDefault: true,
      }],
    }];

    const merged = mergeRuntimeLaunchOptionsIntoModelRegistries(
      cloudRegistries,
      runtimeAgents,
    );

    expect(merged[0]?.models[0]?.aliases).toEqual(["claude-sonnet-4-6"]);
  });

  it("keeps cloud-only dynamic registry rows available for refresh recovery", () => {
    const cloudRegistries: ModelRegistry[] = [
      {
        kind: "codex",
        displayName: "Codex",
        defaultModelId: "gpt-5.5",
        models: [{
          id: "gpt-5.5",
          displayName: "GPT 5.5",
          isDefault: true,
        }],
      },
      {
        kind: "cursor",
        displayName: "Cursor",
        defaultModelId: "auto",
        models: [{
          id: "auto",
          displayName: "Auto",
          isDefault: true,
        }],
      },
    ];
    const runtimeAgents: RuntimeAgentLaunchOptions[] = [{
      kind: "codex",
      displayName: "Codex",
      defaultModelId: "gpt-5.5",
      models: [{
        id: "gpt-5.5",
        displayName: "GPT 5.5",
        isDefault: true,
      }],
    }];

    const merged = mergeRuntimeLaunchOptionsIntoModelRegistries(
      cloudRegistries,
      runtimeAgents,
    );

    expect(merged.map((registry) => registry.kind)).toEqual(["codex", "cursor"]);
  });
});
