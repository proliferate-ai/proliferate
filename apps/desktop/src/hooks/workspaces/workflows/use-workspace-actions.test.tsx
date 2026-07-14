// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessError, type RepoRoot, type Workspace } from "@anyharness/sdk";
import {
  buildWorkspaceCollections,
  type WorkspaceCollections,
} from "@/lib/domain/workspaces/cloud/collections";
import { workspaceCollectionsKey } from "@/hooks/workspaces/cache/query-keys";
import { useWorkspaceActions } from "./use-workspace-actions";

const mocks = vi.hoisted(() => {
  const create = vi.fn();
  const resolveFromPath = vi.fn();
  const createWorktree = vi.fn();
  const getAnyHarnessClient = vi.fn(() => ({
    workspaces: {
      create,
      resolveFromPath,
      createWorktree,
    },
  }));

  return {
    localRuntime: {},
    create,
    resolveFromPath,
    createWorktree,
    getAnyHarnessClient,
    ensureRuntimeReady: vi.fn(async () => "http://localhost:7007"),
    trackProductEvent: vi.fn(),
    captureTelemetryException: vi.fn(),
  };
});

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: mocks.getAnyHarnessClient,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: { runtime: mocks.localRuntime } }),
}));

vi.mock("./runtime-ready", () => ({
  ensureRuntimeReady: mocks.ensureRuntimeReady,
}));

vi.mock("@/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      localWorkspaces: [],
      retiredLocalWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [],
      workspaces: [],
      allWorkspaces: [],
      cleanupAttentionWorkspaces: [],
    },
  }),
}));

vi.mock("@/stores/sessions/harness-connection-store", () => {
  const useHarnessConnectionStore = Object.assign(
    vi.fn((selector: (state: { runtimeUrl: string }) => unknown) =>
      selector({ runtimeUrl: "http://localhost:7007" })),
    {
      getState: vi.fn(() => ({ runtimeUrl: "http://localhost:7007" })),
    },
  );
  return { useHarnessConnectionStore };
});

vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: mocks.captureTelemetryException,
  trackProductEvent: mocks.trackProductEvent,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorkspaceActions local workspace creation", () => {
  it("creates a workspace through the strict create endpoint", async () => {
    const workspace = localWorkspace("workspace-new");
    const repoRoot = localRepoRoot();
    mocks.create.mockResolvedValueOnce({ repoRoot, workspace });

    const { result, queryClient } = renderActions();
    queryClient.setQueryData(
      workspaceCollectionsKey("http://localhost:7007", false),
      buildWorkspaceCollections([], [], []),
    );
    let created: Workspace | null = null;
    await act(async () => {
      created = await result.current.createLocalWorkspace("/Users/pablo/proliferate");
    });

    expect(created).toBe(workspace);
    const collections = queryClient.getQueryData<WorkspaceCollections>(
      workspaceCollectionsKey("http://localhost:7007", false),
    );
    expect(collections?.localWorkspaces.map((entry) => entry.id)).toEqual(["workspace-new"]);
    expect(collections?.repoRoots.map((entry) => entry.id)).toEqual(["repo-1"]);
    expect(mocks.create).toHaveBeenCalledWith({
      path: "/Users/pablo/proliferate",
      origin: { kind: "human", entrypoint: "desktop" },
    });
    expect(mocks.resolveFromPath).not.toHaveBeenCalled();
    expect(mocks.ensureRuntimeReady).toHaveBeenCalledWith(mocks.localRuntime);
    expect(mocks.trackProductEvent).toHaveBeenCalledWith("workspace_created", {
      workspace_kind: "local",
      creation_kind: "local",
    });
  });

  it("updates the cache scoped to the runtime returned by bridge readiness", async () => {
    const readyRuntimeUrl = "http://localhost:8111";
    const workspace = localWorkspace("workspace-dynamic-runtime");
    const repoRoot = localRepoRoot();
    mocks.ensureRuntimeReady.mockResolvedValueOnce(readyRuntimeUrl);
    mocks.create.mockResolvedValueOnce({ repoRoot, workspace });

    const { result, queryClient } = renderActions();
    queryClient.setQueryData(
      workspaceCollectionsKey(readyRuntimeUrl, false),
      buildWorkspaceCollections([], [], []),
    );
    queryClient.setQueryData(
      workspaceCollectionsKey("http://localhost:7007", false),
      buildWorkspaceCollections([], [], []),
    );

    await act(async () => {
      await result.current.createLocalWorkspace("/Users/pablo/proliferate");
    });

    const readyCollections = queryClient.getQueryData<WorkspaceCollections>(
      workspaceCollectionsKey(readyRuntimeUrl, false),
    );
    const staleCollections = queryClient.getQueryData<WorkspaceCollections>(
      workspaceCollectionsKey("http://localhost:7007", false),
    );
    expect(readyCollections?.localWorkspaces.map((entry) => entry.id)).toEqual([
      "workspace-dynamic-runtime",
    ]);
    expect(staleCollections?.localWorkspaces).toEqual([]);
    expect(mocks.getAnyHarnessClient).toHaveBeenCalledWith({
      runtimeUrl: readyRuntimeUrl,
    });
  });

  it("propagates create errors without resolving an existing workspace", async () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Bad request",
      status: 400,
      detail: "a workspace record already exists for path: /Users/pablo/proliferate",
      code: "WORKSPACE_CREATE_FAILED",
    });
    mocks.create.mockRejectedValueOnce(error);

    const { result } = renderActions();
    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.createLocalWorkspace("/Users/pablo/proliferate");
      } catch (caught) {
        thrown = caught;
      }
    });

    expect(thrown).toBe(error);
    expect(mocks.resolveFromPath).not.toHaveBeenCalled();
    expect(mocks.trackProductEvent).not.toHaveBeenCalled();
    expect(mocks.captureTelemetryException).toHaveBeenCalledWith(error, {
      tags: {
        action: "create_local_workspace",
        domain: "workspace",
        workspace_kind: "local",
      },
    });
  });
});

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    queryClient,
    ...renderHook(() => useWorkspaceActions(), { wrapper }),
  };
}

function localWorkspace(id: string): Workspace {
  return {
    id,
    kind: "local",
    repoRootId: "repo-1",
    path: "/Users/pablo/proliferate",
    surface: "standard",
    originalBranch: "main",
    currentBranch: "main",
    displayName: null,
    origin: null,
    creatorContext: null,
    lifecycleState: "active",
    cleanupState: "none",
    cleanupOperation: null,
    cleanupErrorMessage: null,
    cleanupFailedAt: null,
    cleanupAttemptedAt: null,
    executionSummary: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function localRepoRoot(): RepoRoot {
  return {
    id: "repo-1",
    kind: "external",
    path: "/Users/pablo/proliferate",
    displayName: "proliferate",
    defaultBranch: "main",
    remoteProvider: "github",
    remoteOwner: "proliferate-ai",
    remoteRepoName: "proliferate",
    remoteUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}
