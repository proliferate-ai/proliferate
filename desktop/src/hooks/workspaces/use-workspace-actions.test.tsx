// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessError, type Workspace } from "@anyharness/sdk";
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

vi.mock("./runtime-ready", () => ({
  ensureRuntimeReady: mocks.ensureRuntimeReady,
}));

vi.mock("./use-workspaces", () => ({
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

vi.mock("@/stores/sessions/harness-store", () => {
  const useHarnessStore = Object.assign(
    vi.fn((selector: (state: { runtimeUrl: string }) => unknown) =>
      selector({ runtimeUrl: "http://localhost:7007" })),
    {
      getState: vi.fn(() => ({ runtimeUrl: "http://localhost:7007" })),
    },
  );
  return { useHarnessStore };
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
    mocks.create.mockResolvedValueOnce({ workspace });

    const { result } = renderActions();
    let created: Workspace | null = null;
    await act(async () => {
      created = await result.current.createLocalWorkspace("/Users/pablo/proliferate");
    });

    expect(created).toBe(workspace);
    expect(mocks.create).toHaveBeenCalledWith({
      path: "/Users/pablo/proliferate",
      origin: { kind: "human", entrypoint: "desktop" },
    });
    expect(mocks.resolveFromPath).not.toHaveBeenCalled();
    expect(mocks.trackProductEvent).toHaveBeenCalledWith("workspace_created", {
      workspace_kind: "local",
      creation_kind: "local",
    });
  });

  it("opens an existing workspace when create reports the path is already registered", async () => {
    const workspace = localWorkspace("workspace-existing");
    mocks.create.mockRejectedValueOnce(new AnyHarnessError({
      type: "about:blank",
      title: "Bad request",
      status: 400,
      detail: "a workspace record already exists for path: /Users/pablo/proliferate",
      code: "WORKSPACE_CREATE_FAILED",
    }));
    mocks.resolveFromPath.mockResolvedValueOnce({ workspace });

    const { result } = renderActions();
    let resolved: Workspace | null = null;
    await act(async () => {
      resolved = await result.current.createLocalWorkspace("/Users/pablo/proliferate");
    });

    expect(resolved).toBe(workspace);
    expect(mocks.resolveFromPath).toHaveBeenCalledWith({
      path: "/Users/pablo/proliferate",
      origin: { kind: "human", entrypoint: "desktop" },
    });
    expect(mocks.trackProductEvent).not.toHaveBeenCalled();
    expect(mocks.captureTelemetryException).not.toHaveBeenCalled();
  });

  it("propagates non-conflict create errors", async () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Bad request",
      status: 400,
      detail: "path is not a git repository",
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

  it("propagates resolve failures after a duplicate-path create error", async () => {
    const resolveError = new Error("runtime connection lost");
    mocks.create.mockRejectedValueOnce(new AnyHarnessError({
      type: "about:blank",
      title: "Bad request",
      status: 400,
      detail: "a workspace record already exists for path: /Users/pablo/proliferate",
      code: "WORKSPACE_CREATE_FAILED",
    }));
    mocks.resolveFromPath.mockRejectedValueOnce(resolveError);

    const { result } = renderActions();
    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.createLocalWorkspace("/Users/pablo/proliferate");
      } catch (caught) {
        thrown = caught;
      }
    });

    expect(thrown).toBe(resolveError);
    expect(mocks.resolveFromPath).toHaveBeenCalledWith({
      path: "/Users/pablo/proliferate",
      origin: { kind: "human", entrypoint: "desktop" },
    });
    expect(mocks.trackProductEvent).not.toHaveBeenCalled();
    expect(mocks.captureTelemetryException).toHaveBeenCalledWith(resolveError, {
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

  return renderHook(() => useWorkspaceActions(), { wrapper });
}

function localWorkspace(id: string): Workspace {
  return {
    id,
    kind: "local",
    repoRootId: "repo-1",
    path: "/Users/pablo/proliferate",
    surface: "standard",
    sourceRepoRootPath: "/Users/pablo/proliferate",
    sourceWorkspaceId: id,
    gitProvider: null,
    gitOwner: null,
    gitRepoName: null,
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
  } as Workspace;
}
