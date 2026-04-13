import { describe, expect, it } from "vitest";
import type { ModelRegistry } from "@anyharness/sdk";
import {
  pickRecommendedAgentKind,
  resolveOnboardingRecommendation,
} from "./recommendation";

function registry(kind: string, models: string[] = ["default-model"]): ModelRegistry {
  return {
    kind,
    displayName: kind.charAt(0).toUpperCase() + kind.slice(1),
    defaultModelId: models[0] ?? null,
    models: models.map((id, index) => ({
      id,
      displayName: id,
      isDefault: index === 0,
    })),
  };
}

describe("pickRecommendedAgentKind", () => {
  it("prefers codex for ship-features when codex is available", () => {
    const result = pickRecommendedAgentKind("ship-features", [
      registry("claude"),
      registry("codex"),
    ]);
    expect(result).toBe("codex");
  });

  it("prefers claude for understand-codebase", () => {
    const result = pickRecommendedAgentKind("understand-codebase", [
      registry("claude"),
      registry("codex"),
    ]);
    expect(result).toBe("claude");
  });

  it("falls back to chat-launch ordering when preference is not available", () => {
    const result = pickRecommendedAgentKind("ship-features", [
      registry("claude"),
      registry("gemini"),
    ]);
    // claude beats gemini in CHAT_LAUNCH_PROVIDER_ORDER
    expect(result).toBe("claude");
  });

  it("ignores registries with no models", () => {
    const result = pickRecommendedAgentKind("ship-features", [
      registry("codex", []),
      registry("claude"),
    ]);
    expect(result).toBe("claude");
  });

  it("returns null when nothing is installable", () => {
    const result = pickRecommendedAgentKind("ship-features", []);
    expect(result).toBeNull();
  });

  it("falls back to chat-launch ordering when goal is empty", () => {
    const result = pickRecommendedAgentKind("", [
      registry("gemini"),
      registry("codex"),
    ]);
    expect(result).toBe("codex");
  });
});

describe("resolveOnboardingRecommendation", () => {
  it("returns a full agent/model/mode recommendation when registries are ready", () => {
    const result = resolveOnboardingRecommendation({
      goalId: "ship-features",
      availableRegistries: [
        registry("codex", ["codex-small"]),
        registry("claude", ["sonnet"]),
      ],
    });

    expect(result?.agentKind).toBe("codex");
    expect(result?.modelId).toBe("codex-small");
    expect(result?.modeId).toBeDefined();
  });

  it("returns null when no registries are available", () => {
    const result = resolveOnboardingRecommendation({
      goalId: "ship-features",
      availableRegistries: [],
    });
    expect(result).toBeNull();
  });

  it("respects a forced agent kind when that registry is usable", () => {
    const result = resolveOnboardingRecommendation({
      goalId: "ship-features",
      availableRegistries: [
        registry("codex", ["codex-small"]),
        registry("claude", ["sonnet"]),
      ],
      forcedAgentKind: "claude",
    });

    expect(result?.agentKind).toBe("claude");
    expect(result?.modelId).toBe("sonnet");
  });

  it("falls back to the goal recommendation when the forced agent is unusable", () => {
    const result = resolveOnboardingRecommendation({
      goalId: "ship-features",
      availableRegistries: [
        registry("codex", ["codex-small"]),
        registry("claude", []),
      ],
      forcedAgentKind: "claude",
    });

    expect(result?.agentKind).toBe("codex");
    expect(result?.modelId).toBe("codex-small");
  });
});
