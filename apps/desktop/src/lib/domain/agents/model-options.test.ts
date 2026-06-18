import { describe, expect, it } from "vitest";
import {
  buildAgentModelGroups,
  isStoredDefaultModelStale,
  resolveEffectiveAgentModelSelection,
  withClearedDefaultModelIdByAgentKind,
  type AgentCatalogSummary,
  type AgentModelRegistry,
  type AgentModelRegistryModel,
} from "./model-options";

function agent(overrides: Partial<AgentCatalogSummary> & { kind: string }): AgentCatalogSummary {
  return {
    displayName: overrides.displayName ?? overrides.kind,
    readiness: "ready",
    ...overrides,
    kind: overrides.kind,
  };
}

function registry(overrides: Partial<AgentModelRegistry> & { kind: string }): AgentModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [
      model("default-model", "Default Model", true),
    ],
  };
}

function model(
  id: string,
  displayName: string,
  isDefault: boolean,
  overrides: Partial<AgentModelRegistryModel> = {},
): AgentModelRegistryModel {
  return {
    id,
    displayName,
    isDefault,
    status: "active",
    ...overrides,
  };
}

describe("buildAgentModelGroups", () => {
  it("filters non-ready agents", () => {
    const groups = buildAgentModelGroups({
      agents: [
        agent({ kind: "codex" }),
        agent({ kind: "claude", readiness: "install_required" }),
      ],
      modelRegistries: [
        registry({ kind: "codex" }),
        registry({ kind: "claude" }),
      ],
      selected: null,
    });

    expect(groups.map((group) => group.kind)).toEqual(["codex"]);
  });

  it("respects an optional allowlist predicate", () => {
    const groups = buildAgentModelGroups({
      agents: [agent({ kind: "codex" }), agent({ kind: "cursor" })],
      modelRegistries: [registry({ kind: "codex" }), registry({ kind: "cursor" })],
      selected: null,
      isAgentKindAllowed: (kind) => kind !== "cursor",
    });

    expect(groups.map((group) => group.kind)).toEqual(["codex"]);
  });

  it("uses display-name fallback without importing product config", () => {
    const groups = buildAgentModelGroups({
      agents: [agent({ kind: "custom", displayName: "" })],
      modelRegistries: [registry({ kind: "custom", displayName: "" })],
      selected: null,
      fallbackDisplayName: (kind) => `Fallback ${kind}`,
    });

    expect(groups[0]?.providerDisplayName).toBe("Fallback custom");
  });
});

describe("resolveEffectiveAgentModelSelection", () => {
  it("resolves a preferred model", () => {
    const groups = buildAgentModelGroups({
      agents: [agent({ kind: "codex" })],
      modelRegistries: [
        registry({
          kind: "codex",
          defaultModelId: "gpt-5.4",
          models: [
            model("gpt-5.4", "GPT-5.4", true),
            model("gpt-5.4-mini", "Mini", false),
          ],
        }),
      ],
      selected: null,
    });

    expect(resolveEffectiveAgentModelSelection(groups, null, {
      defaultAgentKind: "codex",
      defaultModelIdByAgentKind: {
        codex: "gpt-5.4-mini",
      },
    })).toEqual({ kind: "codex", modelId: "gpt-5.4-mini" });
  });

  it("resolves preferred model aliases to canonical model ids", () => {
    const groups = buildAgentModelGroups({
      agents: [agent({ kind: "cursor" })],
      modelRegistries: [
        registry({
          kind: "cursor",
          defaultModelId: "us.anthropic.claude-sonnet-4-6",
          models: [
            model("us.anthropic.claude-sonnet-4-6", "Sonnet", true, {
              aliases: ["sonnet"],
            }),
          ],
        }),
      ],
      selected: null,
    });

    expect(resolveEffectiveAgentModelSelection(groups, null, {
      defaultAgentKind: "cursor",
      defaultModelIdByAgentKind: {
        cursor: "sonnet",
      },
    })).toEqual({
      kind: "cursor",
      modelId: "us.anthropic.claude-sonnet-4-6",
    });
  });

  it("keeps the primary harness when its preferred model is unavailable", () => {
    const groups = buildAgentModelGroups({
      agents: [agent({ kind: "codex" }), agent({ kind: "claude" })],
      modelRegistries: [
        registry({
          kind: "codex",
          defaultModelId: "gpt-5.4",
          models: [
            model("gpt-5.4", "GPT-5.4", true),
          ],
        }),
        registry({
          kind: "claude",
          defaultModelId: "sonnet",
          models: [
            model("sonnet", "Sonnet", true),
          ],
        }),
      ],
      selected: null,
    });

    expect(resolveEffectiveAgentModelSelection(groups, null, {
      defaultAgentKind: "codex",
      defaultModelIdByAgentKind: {
        codex: "stale-model",
        claude: "sonnet",
      },
    })).toEqual({ kind: "codex", modelId: "gpt-5.4" });
  });

  it("uses an explicit override before primary preferences", () => {
    const groups = buildAgentModelGroups({
      agents: [agent({ kind: "codex" }), agent({ kind: "claude" })],
      modelRegistries: [
        registry({
          kind: "codex",
          models: [model("gpt-5.4", "GPT-5.4", true)],
        }),
        registry({
          kind: "claude",
          models: [model("sonnet", "Sonnet", true)],
        }),
      ],
      selected: null,
    });

    expect(resolveEffectiveAgentModelSelection(
      groups,
      { kind: "claude", modelId: "sonnet" },
      {
        defaultAgentKind: "codex",
        defaultModelIdByAgentKind: {
          codex: "gpt-5.4",
        },
      },
    )).toEqual({ kind: "claude", modelId: "sonnet" });
  });

  it("falls back to provider default, then first model", () => {
    const defaultGroups = buildAgentModelGroups({
      agents: [agent({ kind: "codex" })],
      modelRegistries: [
        registry({
          kind: "codex",
          defaultModelId: "second",
          models: [
            model("first", "First", false),
            model("second", "Second", true),
          ],
        }),
      ],
      selected: null,
    });

    expect(resolveEffectiveAgentModelSelection(defaultGroups, null, {
      defaultAgentKind: "missing",
      defaultModelIdByAgentKind: {},
    })).toEqual({ kind: "codex", modelId: "second" });

    const firstGroups = buildAgentModelGroups({
      agents: [agent({ kind: "codex" })],
      modelRegistries: [
        registry({
          kind: "codex",
          defaultModelId: null,
          models: [
            model("first", "First", false),
            model("second", "Second", false),
          ],
        }),
      ],
      selected: null,
    });

    expect(resolveEffectiveAgentModelSelection(firstGroups, null, {
      defaultAgentKind: "missing",
      defaultModelIdByAgentKind: {},
    })).toEqual({ kind: "codex", modelId: "first" });
  });
});

describe("withClearedDefaultModelIdByAgentKind", () => {
  it("removes the stored default for the given agent kind", () => {
    expect(
      withClearedDefaultModelIdByAgentKind(
        { claude: "us.anthropic.claude-sonnet-4-6", codex: "gpt-5.5" },
        "claude",
      ),
    ).toEqual({ codex: "gpt-5.5" });
  });

  it("returns the same reference when there is nothing to clear", () => {
    const defaults = { codex: "gpt-5.5" };
    expect(withClearedDefaultModelIdByAgentKind(defaults, "claude")).toBe(defaults);
    expect(withClearedDefaultModelIdByAgentKind(defaults, "  ")).toBe(defaults);
  });
});

describe("isStoredDefaultModelStale", () => {
  const models = [
    { id: "sonnet", aliases: ["claude-sonnet-4-6"] },
    { id: "opus" },
  ];

  it("is stale when the stored id is absent from the gated runtime models", () => {
    // e.g. a bedrock id left over after switching to oauth
    expect(isStoredDefaultModelStale("us.anthropic.claude-sonnet-4-6", models)).toBe(true);
  });

  it("is not stale when the stored id matches a model id", () => {
    expect(isStoredDefaultModelStale("opus", models)).toBe(false);
  });

  it("is not stale when the stored id matches a model alias", () => {
    expect(isStoredDefaultModelStale("claude-sonnet-4-6", models)).toBe(false);
  });

  it("never reports stale without a stored id or runtime models (loading/unclassified guard)", () => {
    expect(isStoredDefaultModelStale(undefined, models)).toBe(false);
    expect(isStoredDefaultModelStale("", models)).toBe(false);
    expect(isStoredDefaultModelStale("opus", null)).toBe(false);
    expect(isStoredDefaultModelStale("opus", undefined)).toBe(false);
  });
});
