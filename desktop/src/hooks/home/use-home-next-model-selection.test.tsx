// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, ModelRegistry } from "@anyharness/sdk";
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
}));

vi.mock("@/hooks/agents/use-agent-catalog", () => ({
  useAgentCatalog: () => selectionMocks.agentCatalog,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useModelRegistriesQuery: () => selectionMocks.modelRegistriesQuery,
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

function resetMocks() {
  selectionMocks.agentCatalog.readyAgents = [];
  selectionMocks.agentCatalog.isLoading = false;
  selectionMocks.agentCatalog.isError = false;
  selectionMocks.agentCatalog.error = null;
  selectionMocks.modelRegistriesQuery.data = [];
  selectionMocks.modelRegistriesQuery.isLoading = false;
  selectionMocks.modelRegistriesQuery.isError = false;
  selectionMocks.modelRegistriesQuery.error = null;
  useUserPreferencesStore.setState({
    defaultChatAgentKind: "codex",
    defaultChatModelIdByAgentKind: {},
  });
}

describe("useHomeNextModelSelection", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses loading precedence before errors and launchability", () => {
    selectionMocks.agentCatalog.readyAgents = [agent("codex")];
    selectionMocks.agentCatalog.isLoading = true;
    selectionMocks.modelRegistriesQuery.isError = true;
    selectionMocks.modelRegistriesQuery.data = [registry("codex")];

    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
    }));

    expect(result.current.modelAvailabilityState).toBe("loading");
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
});
