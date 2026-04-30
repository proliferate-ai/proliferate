import { describe, expect, it } from "vitest";
import type { AgentSummary, ModelRegistry } from "@anyharness/sdk";
import {
  buildAutomationModelGroups,
  resolveAutomationModelSelection,
} from "./model-selection";

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

const EMPTY_PREFERENCES = {
  defaultChatAgentKind: "",
  defaultChatModelId: "",
};

describe("buildAutomationModelGroups", () => {
  it("filters unsupported agents and agents that are not ready", () => {
    const groups = buildAutomationModelGroups(
      [
        agent({ kind: "codex" }),
        agent({ kind: "cursor" }),
        agent({ kind: "gemini", readiness: "install_required" }),
      ],
      [
        registry({ kind: "codex" }),
        registry({ kind: "cursor" }),
        registry({ kind: "gemini" }),
      ],
      null,
    );

    expect(groups.map((group) => group.kind)).toEqual(["codex"]);
  });
});

describe("resolveAutomationModelSelection", () => {
  const groups = buildAutomationModelGroups(
    [
      agent({ kind: "claude", displayName: "Claude" }),
      agent({ kind: "codex", displayName: "Codex" }),
    ],
    [
      registry({
        kind: "claude",
        displayName: "Claude",
        defaultModelId: "claude-default",
        models: [
          {
            id: "claude-default",
            displayName: "Claude Default",
            isDefault: true,
          },
        ],
      }),
      registry({
        kind: "codex",
        displayName: "Codex",
        defaultModelId: "codex-default",
        models: [
          {
            id: "codex-default",
            displayName: "Codex Default",
            isDefault: true,
          },
          {
            id: "codex-fast",
            displayName: "Codex Fast",
            isDefault: false,
          },
        ],
      }),
    ],
    null,
  );

  it("uses a valid user-preferred model for new automations", () => {
    const resolution = resolveAutomationModelSelection({
      groups,
      saved: { agentKind: null, modelId: null },
      override: null,
      preferences: {
        defaultChatAgentKind: "codex",
        defaultChatModelId: "codex-fast",
      },
      isEditing: false,
    });

    expect(resolution.state).toBe("default");
    expect(resolution.submission).toMatchObject({
      agentKind: "codex",
      modelId: "codex-fast",
      canSubmit: true,
    });
  });

  it("falls back to provider default and then first model for new automations", () => {
    const fallback = resolveAutomationModelSelection({
      groups,
      saved: { agentKind: null, modelId: null },
      override: null,
      preferences: {
        defaultChatAgentKind: "missing",
        defaultChatModelId: "missing",
      },
      isEditing: false,
    });

    expect(fallback.state).toBe("default");
    expect(fallback.submission).toMatchObject({
      agentKind: "claude",
      modelId: "claude-default",
      canSubmit: true,
    });

    const noDefaultGroups = buildAutomationModelGroups(
      [agent({ kind: "codex" })],
      [
        registry({
          kind: "codex",
          defaultModelId: null,
          models: [
            { id: "first", displayName: "First", isDefault: false },
            { id: "second", displayName: "Second", isDefault: false },
          ],
        }),
      ],
      null,
    );
    const firstModel = resolveAutomationModelSelection({
      groups: noDefaultGroups,
      saved: { agentKind: null, modelId: null },
      override: null,
      preferences: EMPTY_PREFERENCES,
      isEditing: false,
    });

    expect(firstModel.submission).toMatchObject({
      agentKind: "codex",
      modelId: "first",
      canSubmit: true,
    });
  });

  it("preserves a saved null model for existing automations", () => {
    const resolution = resolveAutomationModelSelection({
      groups,
      saved: { agentKind: "codex", modelId: null },
      override: null,
      preferences: EMPTY_PREFERENCES,
      isEditing: true,
    });

    expect(resolution.state).toBe("default");
    expect(resolution.submission).toMatchObject({
      agentKind: "codex",
      modelId: null,
      canSubmit: true,
    });
  });

  it("allows users to explicitly return to a null default model", () => {
    const resolution = resolveAutomationModelSelection({
      groups,
      saved: { agentKind: "codex", modelId: "codex-fast" },
      override: { kind: "codex", modelId: null },
      preferences: EMPTY_PREFERENCES,
      isEditing: true,
    });

    expect(resolution).toMatchObject({
      state: "default",
      source: "overrideNull",
      submission: {
        agentKind: "codex",
        modelId: null,
        canSubmit: true,
      },
    });
  });

  it("preserves a stale saved model without blocking supported agents", () => {
    const resolution = resolveAutomationModelSelection({
      groups,
      saved: { agentKind: "codex", modelId: "old-model" },
      override: null,
      preferences: EMPTY_PREFERENCES,
      isEditing: true,
    });

    expect(resolution).toMatchObject({
      state: "savedUnavailable",
      reason: "modelUnavailable",
      submission: {
        agentKind: "codex",
        modelId: "old-model",
        canSubmit: true,
      },
    });
  });

  it("blocks existing automations with unsupported or missing agents", () => {
    const unsupported = resolveAutomationModelSelection({
      groups,
      saved: { agentKind: "cursor", modelId: "cursor-model" },
      override: null,
      preferences: EMPTY_PREFERENCES,
      isEditing: true,
    });
    const missing = resolveAutomationModelSelection({
      groups,
      saved: { agentKind: null, modelId: null },
      override: null,
      preferences: EMPTY_PREFERENCES,
      isEditing: true,
    });

    expect(unsupported.submission.canSubmit).toBe(false);
    expect(missing.submission.canSubmit).toBe(false);
  });
});
