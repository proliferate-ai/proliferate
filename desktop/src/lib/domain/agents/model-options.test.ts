import { describe, expect, it } from "vitest";
import type { AgentSummary, ModelRegistry, ModelRegistryModel } from "@anyharness/sdk";
import {
  buildAgentModelGroups,
  resolveEffectiveAgentModelSelection,
} from "./model-options";

function agent(overrides: Partial<AgentSummary> & { kind: string }): AgentSummary {
  return {
    displayName: overrides.displayName ?? overrides.kind,
    readiness: "ready",
    installState: "installed",
    credentialState: "ready",
    expectedEnvVars: [],
    nativeRequired: false,
    supportsLogin: true,
    agentProcess: {
      installed: true,
      role: "agent",
    },
    ...overrides,
    kind: overrides.kind,
  };
}

function registry(overrides: Partial<ModelRegistry> & { kind: string }): ModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [
      model("default-model", "Default Model", true),
    ],
  };
}

function model(id: string, displayName: string, isDefault: boolean): ModelRegistryModel {
  return {
    id,
    displayName,
    isDefault,
    status: "active",
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
      defaultModelId: "gpt-5.4-mini",
    })).toEqual({ kind: "codex", modelId: "gpt-5.4-mini" });
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
      defaultModelId: "missing",
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
      defaultModelId: "missing",
    })).toEqual({ kind: "codex", modelId: "first" });
  });
});
