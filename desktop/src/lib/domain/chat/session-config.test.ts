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
  it("uses registry model rows for ready launch agents instead of intersecting live launch models", () => {
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
    expect(merged[0]?.models.map((model) => model.id)).toEqual(["gpt-5.5", "gpt-5.4"]);
    expect(merged[0]?.displayName).toBe("Codex");
  });
});
