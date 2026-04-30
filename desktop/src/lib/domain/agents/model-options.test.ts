import { describe, expect, it } from "vitest";
import type { AgentSummary, ModelRegistry } from "@anyharness/sdk";
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
      {
        id: "default-model",
        displayName: "Default Model",
        isDefault: true,
      },
    ],
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
            { id: "gpt-5.4", displayName: "GPT-5.4", isDefault: true },
            { id: "gpt-5.4-mini", displayName: "Mini", isDefault: false },
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
            { id: "first", displayName: "First", isDefault: false },
            { id: "second", displayName: "Second", isDefault: true },
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
            { id: "first", displayName: "First", isDefault: false },
            { id: "second", displayName: "Second", isDefault: false },
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
