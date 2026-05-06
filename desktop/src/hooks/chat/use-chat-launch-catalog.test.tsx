// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useChatLaunchCatalog } from "./use-chat-launch-catalog";

const mocks = vi.hoisted(() => ({
  useEffectiveAgentCatalogQuery: vi.fn(),
  useWorkspaceSessionLaunchQuery: vi.fn(),
  useModelRegistriesQuery: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useEffectiveAgentCatalogQuery: mocks.useEffectiveAgentCatalogQuery,
  useWorkspaceSessionLaunchQuery: mocks.useWorkspaceSessionLaunchQuery,
  useModelRegistriesQuery: mocks.useModelRegistriesQuery,
}));

vi.mock("@/hooks/workspaces/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => ({ state: null }),
}));

describe("useChatLaunchCatalog", () => {
  beforeEach(() => {
    mocks.useWorkspaceSessionLaunchQuery.mockReturnValue({
      data: {
        workspaceId: "workspace-1",
        catalogVersion: "test",
        agents: [],
      },
      isLoading: false,
      error: null,
    });
    mocks.useModelRegistriesQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    mocks.useEffectiveAgentCatalogQuery.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    useHarnessConnectionStore.setState({
      runtimeUrl: "http://runtime.test",
      connectionState: "healthy",
      error: null,
    });
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: null,
      selectedWorkspaceId: "workspace-1",
      hotPaintGate: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gates session launch and model registry queries during hot paint", () => {
    useSessionSelectionStore.setState({
      hotPaintGate: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        nonce: 1,
        operationId: null,
        kind: "workspace_hot_reopen",
      },
    });

    renderHook(() => useChatLaunchCatalog({ activeSelection: null }));

    expect(mocks.useWorkspaceSessionLaunchQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      enabled: false,
    });
    expect(mocks.useEffectiveAgentCatalogQuery).toHaveBeenCalledWith({
      enabled: false,
    });
    expect(mocks.useModelRegistriesQuery).toHaveBeenCalledWith({
      enabled: false,
    });
  });

  it("enables launch catalog queries for a ready local workspace outside hot paint", () => {
    renderHook(() => useChatLaunchCatalog({ activeSelection: null }));

    expect(mocks.useWorkspaceSessionLaunchQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      enabled: true,
    });
    expect(mocks.useEffectiveAgentCatalogQuery).toHaveBeenCalledWith({
      enabled: true,
    });
    expect(mocks.useModelRegistriesQuery).toHaveBeenCalledWith({
      enabled: true,
    });
  });
});
