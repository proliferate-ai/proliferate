// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import type { AgentModelRegistry as ModelRegistry } from "@/lib/domain/agents/model-options";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useAutomationModelSelection } from "./use-automation-model-selection";

const selectionMocks = vi.hoisted(() => ({
  agentCatalog: {
    readyAgents: [] as AgentSummary[],
    isLoading: false,
  },
  modelRegistriesQuery: {
    data: [] as ModelRegistry[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  runtimeLaunchOptions: {
    data: null as { agents: unknown[] } | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => selectionMocks.agentCatalog,
}));

vi.mock("@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog", () => ({
  useCloudLaunchModelRegistries: () => selectionMocks.modelRegistriesQuery,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => selectionMocks.runtimeLaunchOptions,
}));

function agent(kind: string): AgentSummary {
  return {
    kind,
    displayName: kind,
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
  };
}

function resetMocks() {
  selectionMocks.agentCatalog.readyAgents = [];
  selectionMocks.agentCatalog.isLoading = false;
  selectionMocks.modelRegistriesQuery.data = [];
  selectionMocks.modelRegistriesQuery.isLoading = false;
  selectionMocks.modelRegistriesQuery.isError = false;
  selectionMocks.modelRegistriesQuery.error = null;
  selectionMocks.runtimeLaunchOptions.data = null;
  selectionMocks.runtimeLaunchOptions.isLoading = false;
  selectionMocks.runtimeLaunchOptions.isError = false;
  selectionMocks.runtimeLaunchOptions.error = null;
  useUserPreferencesStore.setState({
    defaultChatAgentKind: "codex",
    defaultChatModelIdByAgentKind: {},
    chatModelVisibilityOverridesByAgentKind: {},
  });
}

describe("useAutomationModelSelection", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses visible model preferences for new automation defaults", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];
    selectionMocks.modelRegistriesQuery.data = [{
      kind: "codex",
      displayName: "Codex",
      defaultModelId: "gpt-5.5",
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT 5.5",
          isDefault: true,
          status: "active",
          defaultOptIn: true,
        },
        {
          id: "gpt-5.3-codex-spark",
          displayName: "GPT 5.3 Codex Spark",
          isDefault: false,
          status: "active",
          defaultOptIn: true,
        },
      ],
    }];
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "codex",
      defaultChatModelIdByAgentKind: { codex: "gpt-5.5" },
      chatModelVisibilityOverridesByAgentKind: {
        codex: {
          "gpt-5.5": false,
        },
      },
    });

    const { result } = renderHook(() => useAutomationModelSelection({
      savedAgentKind: null,
      savedModelId: null,
      override: null,
      isEditing: false,
    }));

    expect(result.current.resolution.submission).toMatchObject({
      agentKind: "codex",
      modelId: "gpt-5.3-codex-spark",
      canSubmit: true,
    });
    expect(result.current.groups[0]?.models.map((model) => model.modelId))
      .toEqual(["gpt-5.3-codex-spark"]);
  });

  it("uses runtime-refreshed models for new automation defaults", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];
    selectionMocks.modelRegistriesQuery.data = [{
      kind: "codex",
      displayName: "Codex",
      defaultModelId: "gpt-5.5",
      models: [{
        id: "gpt-5.5",
        displayName: "GPT 5.5",
        isDefault: true,
        status: "active",
        defaultOptIn: true,
      }],
    }];
    selectionMocks.runtimeLaunchOptions.data = {
      agents: [{
        kind: "codex",
        displayName: "Codex",
        defaultModelId: "gpt-5.5-runtime",
        models: [{
          id: "gpt-5.5-runtime",
          displayName: "GPT 5.5 Runtime",
          isDefault: true,
          defaultOptIn: true,
        }],
      }],
    };
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "codex",
      defaultChatModelIdByAgentKind: {
        codex: "gpt-5.5-runtime",
      },
      chatModelVisibilityOverridesByAgentKind: {},
    });

    const { result } = renderHook(() => useAutomationModelSelection({
      savedAgentKind: null,
      savedModelId: null,
      override: null,
      isEditing: false,
    }));

    expect(result.current.resolution.submission).toMatchObject({
      agentKind: "codex",
      modelId: "gpt-5.5-runtime",
      canSubmit: true,
    });
    expect(result.current.groups[0]?.models.map((model) => model.modelId))
      .toEqual(["gpt-5.5-runtime"]);
  });
});
