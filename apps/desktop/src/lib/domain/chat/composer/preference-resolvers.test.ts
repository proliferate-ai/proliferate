import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import type {
  AgentCatalogSummary,
  AgentModelRegistry,
  AgentModelRegistryModel,
} from "@/lib/domain/agents/model-options";
import {
  resolveConfiguredLaunchSelection,
  resolveEffectiveChatDefaults,
  resolvePreferredOpenTarget,
} from "./preference-resolvers";

function agent(overrides: Partial<AgentCatalogSummary> & { kind: string }): AgentCatalogSummary {
  return {
    displayName: overrides.displayName ?? overrides.kind,
    readiness: "ready",
    ...overrides,
    kind: overrides.kind,
  };
}

function model(id: string, displayName: string, isDefault: boolean): AgentModelRegistryModel {
  return {
    id,
    displayName,
    isDefault,
    status: "active",
  };
}

function registry(overrides: Partial<AgentModelRegistry> & { kind: string }): AgentModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [model("default-model", "Default Model", true)],
  };
}

function launchAgent(
  overrides: Partial<DesktopAgentLaunchAgent> & { kind: string },
): DesktopAgentLaunchAgent {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [
      {
        id: "default-model",
        displayName: "Default Model",
        aliases: [],
        status: "active",
        isDefault: true,
      },
    ],
    launchControls: [],
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
          models: [{
            id: "gpt-5.4",
            displayName: "GPT-5.4",
            aliases: [],
            status: "active",
            isDefault: true,
          }],
        }),
      ],
      {
        defaultChatAgentKind: "claude",
        defaultChatModelIdByAgentKind: {
          claude: "sonnet",
        },
      },
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
          models: [{
            id: "gpt-5.4",
            displayName: "GPT-5.4",
            aliases: [],
            status: "active",
            isDefault: true,
          }],
        }),
      ],
      {
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {
          codex: "stale-model",
        },
      },
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

  it("resolves a variant-suffixed stored model id onto its catalog base model", () => {
    const result = resolveConfiguredLaunchSelection(
      [
        launchAgent({
          kind: "codex",
          defaultModelId: "gpt-5.5",
          models: [{
            id: "gpt-5.5",
            displayName: "GPT-5.5",
            aliases: [],
            status: "active",
            isDefault: true,
          }],
        }),
      ],
      {
        defaultChatAgentKind: "codex",
        defaultChatModelIdByAgentKind: {
          codex: "gpt-5.5/high",
        },
      },
    );

    expect(result).toMatchObject({
      selection: {
        kind: "codex",
        modelId: "gpt-5.5",
      },
      displayName: "GPT-5.5",
      status: "ready",
    });
  });

  it("falls back to the catalog default when a stored dynamic id no longer resolves", () => {
    const result = resolveConfiguredLaunchSelection(
      [
        launchAgent({
          kind: "opencode",
          displayName: "OpenCode",
          defaultModelId: "opencode/big-pickle",
          models: [{
            id: "opencode/big-pickle",
            displayName: "OpenCode Zen/Big Pickle",
            aliases: [],
            status: "active",
            isDefault: true,
          }],
        }),
      ],
      {
        defaultChatAgentKind: "opencode",
        defaultChatModelIdByAgentKind: {
          opencode: "anthropic/claude-sonnet-4-6",
        },
      },
    );

    expect(result).toMatchObject({
      selection: {
        kind: "opencode",
        modelId: "opencode/big-pickle",
      },
      displayName: "OpenCode Zen/Big Pickle",
      status: "ready",
    });
  });
});

describe("resolvePreferredOpenTarget", () => {
  it("falls back to Cursor when the saved target is missing and Cursor is available", () => {
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

  it("falls back to another editor before Finder when Cursor is not available", () => {
    const resolved = resolvePreferredOpenTarget(
      [
        { id: "finder", label: "Finder", kind: "finder", iconId: "finder" },
        { id: "code", label: "VS Code", kind: "editor", iconId: "vscode" },
        { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      ],
      { defaultOpenInTargetId: "missing-editor" },
    );

    expect(resolved?.id).toBe("code");
  });

  it("falls back to Finder when no editor is available", () => {
    const resolved = resolvePreferredOpenTarget(
      [
        { id: "finder", label: "Finder", kind: "finder", iconId: "finder" },
        { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      ],
      { defaultOpenInTargetId: "missing-editor" },
    );

    expect(resolved?.id).toBe("finder");
  });

  it("falls back to the first available target when neither Cursor nor Finder is available", () => {
    const resolved = resolvePreferredOpenTarget(
      [
        { id: "terminal", label: "Terminal", kind: "terminal", iconId: "terminal" },
      ],
      { defaultOpenInTargetId: "missing-editor" },
    );

    expect(resolved?.id).toBe("terminal");
  });
});
