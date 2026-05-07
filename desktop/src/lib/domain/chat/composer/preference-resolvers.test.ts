import { describe, expect, it } from "vitest";
import type {
  AgentSummary,
  ModelRegistry,
  ModelRegistryModel,
  ProviderConfig,
  WorkspaceSessionLaunchAgent,
} from "@anyharness/sdk";
import {
  resolveConfiguredLaunchSelection,
  resolveEffectiveChatDefaults,
  resolvePreferredOpenTarget,
} from "./preference-resolvers";

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

function model(id: string, displayName: string, isDefault: boolean): ModelRegistryModel {
  return {
    id,
    displayName,
    isDefault,
    status: "active",
  };
}

function registry(overrides: Partial<ModelRegistry> & { kind: string }): ModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [model("default-model", "Default Model", true)],
  };
}

function provider(overrides: Partial<ProviderConfig> & { kind: string }): ProviderConfig {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    models: overrides.models ?? [model("default-model", "Default Model", true)],
  };
}

function launchAgent(
  overrides: Partial<WorkspaceSessionLaunchAgent> & { kind: string },
): WorkspaceSessionLaunchAgent {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [
      { id: "default-model", displayName: "Default Model", isDefault: true },
    ],
  };
}

describe("resolveEffectiveChatDefaults", () => {
  it("falls back to the primary catalog default when the per-harness model is stale", () => {
    const result = resolveEffectiveChatDefaults(
      [
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
          models: [model("sonnet", "Sonnet", true)],
        }),
      ],
      [agent({ kind: "codex" }), agent({ kind: "claude" })],
      {
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {
          codex: "stale-model",
          claude: "sonnet",
        },
      },
    );

    expect(result).toMatchObject({
      agentKind: "codex",
      modelId: "gpt-5.4",
      degraded: true,
    });
  });

  it("uses explicit overrides before stored defaults", () => {
    const result = resolveEffectiveChatDefaults(
      [
        registry({
          kind: "codex",
          models: [model("gpt-5.4", "GPT-5.4", true)],
        }),
        registry({
          kind: "claude",
          models: [model("sonnet", "Sonnet", true)],
        }),
      ],
      [agent({ kind: "codex" }), agent({ kind: "claude" })],
      {
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {
          codex: "gpt-5.4",
        },
      },
      { kind: "claude", modelId: "sonnet" },
    );

    expect(result).toMatchObject({
      agentKind: "claude",
      modelId: "sonnet",
      degraded: false,
    });
  });

  it("falls back to the first eligible candidate when preferences are empty", () => {
    const result = resolveEffectiveChatDefaults(
      [
        registry({
          kind: "codex",
          defaultModelId: "gpt-5.4",
          models: [model("gpt-5.4", "GPT-5.4", true)],
        }),
      ],
      [agent({ kind: "codex" })],
      {
        defaultChatAgentKind: "",
        defaultChatModelIdByAgentKind: {},
      },
    );

    expect(result).toMatchObject({
      agentKind: "codex",
      modelId: "gpt-5.4",
      degraded: false,
    });
  });
});

describe("resolveConfiguredLaunchSelection", () => {
  it("reports the configured primary as unavailable instead of falling back", () => {
    const result = resolveConfiguredLaunchSelection(
      [
        launchAgent({
          kind: "codex",
          models: [{ id: "gpt-5.4", displayName: "GPT-5.4", isDefault: true }],
        }),
      ],
      {
        defaultChatAgentKind: "claude",
        defaultChatModelIdByAgentKind: {
          claude: "sonnet",
        },
      },
      [
        provider({
          kind: "claude",
          models: [model("sonnet", "Sonnet", true)],
        }),
      ],
    );

    expect(result).toMatchObject({
      selection: null,
      status: "unavailable",
      reason: "claude is not ready yet.",
    });
  });

  it("uses the primary catalog default when its stored model is stale", () => {
    const result = resolveConfiguredLaunchSelection(
      [
        launchAgent({
          kind: "codex",
          defaultModelId: "gpt-5.4",
          models: [{ id: "gpt-5.4", displayName: "GPT-5.4", isDefault: true }],
        }),
      ],
      {
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {
          codex: "stale-model",
        },
      },
      [
        provider({
          kind: "codex",
          models: [model("gpt-5.4", "GPT-5.4", true)],
        }),
      ],
    );

    expect(result).toMatchObject({
      selection: {
        kind: "codex",
        modelId: "gpt-5.4",
      },
      displayName: "GPT-5.4",
      status: "ready",
    });
  });
});

describe("resolvePreferredOpenTarget", () => {
  it("falls back to the first available editor when the saved target is missing", () => {
    const resolved = resolvePreferredOpenTarget(
      [
        { id: "finder", label: "Finder", kind: "finder", iconId: "finder" },
        { id: "cursor", label: "Cursor", kind: "editor", iconId: "cursor" },
        { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      ],
      { defaultOpenInTargetId: "missing-editor" },
    );

    expect(resolved?.id).toBe("cursor");
  });

  it("falls back to the first target when no editors are available", () => {
    const resolved = resolvePreferredOpenTarget(
      [
        { id: "finder", label: "Finder", kind: "finder", iconId: "finder" },
        { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      ],
      { defaultOpenInTargetId: "missing-editor" },
    );

    expect(resolved?.id).toBe("finder");
  });
});
