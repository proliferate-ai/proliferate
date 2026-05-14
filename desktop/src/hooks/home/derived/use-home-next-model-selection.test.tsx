// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import type { AgentModelRegistry as ModelRegistry } from "@/lib/domain/agents/model-options";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useHomeNextModelSelection } from "./use-home-next-model-selection";

const selectionMocks = vi.hoisted(() => ({
  agentCatalog: {
    readyAgents: [] as AgentSummary[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
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

function registry(kind: string): ModelRegistry {
  return {
    kind,
    displayName: kind,
    defaultModelId: "default-model",
    models: [
      {
        id: "default-model",
        displayName: "Default Model",
        isDefault: true,
        status: "active",
      },
    ],
  };
}

function registryWithModels(
  kind: string,
  models: ModelRegistry["models"],
  defaultModelId = models[0]?.id ?? null,
): ModelRegistry {
  return {
    kind,
    displayName: kind,
    defaultModelId,
    models,
  };
}

function resetMocks() {
  selectionMocks.agentCatalog.readyAgents = [];
  selectionMocks.agentCatalog.isLoading = false;
  selectionMocks.agentCatalog.isError = false;
  selectionMocks.agentCatalog.error = null;
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

describe("useHomeNextModelSelection", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps launchable catalog models usable while runtime details refresh", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];
    selectionMocks.agentCatalog.isLoading = true;
    selectionMocks.modelRegistriesQuery.isError = true;
    selectionMocks.modelRegistriesQuery.data = [registry("codex")];

    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));

    expect(result.current.modelAvailabilityState).toBe("launchable");
  });

  it("treats agent and registry errors as load errors", () => {
    selectionMocks.agentCatalog.isError = true;
    let rendered = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));
    expect(rendered.result.current.modelAvailabilityState).toBe("load_error");
    rendered.unmount();

    resetMocks();
    selectionMocks.modelRegistriesQuery.isError = true;
    rendered = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));
    expect(rendered.result.current.modelAvailabilityState).toBe("load_error");
  });

  it("marks a ready agent without a launchable registry model as no-launchable-model", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];

    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));

    expect(result.current.modelAvailabilityState).toBe("no_launchable_model");
  });

  it("marks ready registry-backed models as launchable", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];
    selectionMocks.modelRegistriesQuery.data = [registry("codex")];

    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));

    expect(result.current.modelAvailabilityState).toBe("launchable");
  });

  it("does not block launchable catalog models on runtime launch option errors", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];
    selectionMocks.modelRegistriesQuery.data = [registry("codex")];
    selectionMocks.runtimeLaunchOptions.isError = true;
    selectionMocks.runtimeLaunchOptions.error = new Error("runtime refresh failed");

    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));

    expect(result.current.modelAvailabilityState).toBe("launchable");
    expect(result.current.effectiveModelSelection).toEqual({
      kind: "codex",
      modelId: "default-model",
    });
  });

  it("uses visible model preferences for the home default launch selection", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];
    selectionMocks.modelRegistriesQuery.data = [
      registryWithModels("codex", [
        {
          id: "default-model",
          displayName: "Default Model",
          isDefault: true,
          status: "active",
          defaultOptIn: true,
        },
        {
          id: "fast-model",
          displayName: "Fast Model",
          isDefault: false,
          status: "active",
          defaultOptIn: true,
        },
      ], "default-model"),
    ];
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "codex",
      defaultChatModelIdByAgentKind: { codex: "default-model" },
      chatModelVisibilityOverridesByAgentKind: {
        codex: {
          "default-model": false,
        },
      },
    });

    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));

    expect(result.current.effectiveModelSelection).toEqual({
      kind: "codex",
      modelId: "fast-model",
    });
    expect(result.current.modelGroups[0]?.models.map((model) => model.modelId))
      .toEqual(["fast-model"]);
  });

  it("uses runtime-refreshed dynamic models for home launch defaults", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("cursor")];
    selectionMocks.modelRegistriesQuery.data = [
      registryWithModels("cursor", [
        {
          id: "auto",
          displayName: "Auto",
          isDefault: true,
          status: "active",
          defaultOptIn: true,
        },
      ], "auto"),
    ];
    selectionMocks.runtimeLaunchOptions.data = {
      agents: [{
        kind: "cursor",
        displayName: "Cursor",
        defaultModelId: "anthropic/claude-sonnet-4-6",
        models: [{
          id: "anthropic/claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6",
          isDefault: true,
          defaultOptIn: true,
        }],
      }],
    };
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "cursor",
      defaultChatModelIdByAgentKind: {
        cursor: "anthropic/claude-sonnet-4-6",
      },
      chatModelVisibilityOverridesByAgentKind: {},
    });

    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));

    expect(result.current.effectiveModelSelection).toEqual({
      kind: "cursor",
      modelId: "anthropic/claude-sonnet-4-6",
    });
    expect(result.current.modelGroups[0]?.models.map((model) => model.modelId))
      .toEqual(["anthropic/claude-sonnet-4-6"]);
  });
});
