// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { buildWorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";
import { buildLogicalWorkspaces } from "@/lib/domain/workspaces/cloud/logical-workspaces";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { workspaceCollectionsKey } from "./query-keys";
import { useWorkspaces } from "./use-workspaces";

const mocks = vi.hoisted(() => {
  const workspacesList = vi.fn();
  const repoRootsList = vi.fn();
  const listCloudWorkspaces = vi.fn();

  return {
    cloudActive: false,
    listCloudWorkspaces,
    repoRootsList,
    workspacesList,
  };
});

vi.mock("@/lib/access/anyharness/workspaces", () => ({
  listRepoRoots: mocks.repoRootsList,
  listRuntimeWorkspaces: mocks.workspacesList,
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudActive: mocks.cloudActive,
  }),
}));

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({
  listCloudWorkspaces: mocks.listCloudWorkspaces,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    auth: { state: { status: "anonymous", methods: [] } },
  }),
}));

describe("useWorkspaces", () => {

  beforeEach(() => {
    mocks.cloudActive = false;
    useHarnessConnectionStore.setState({
      runtimeUrl: "http://runtime.test",
      connectionState: "healthy",
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    mocks.listCloudWorkspaces.mockReset();
    mocks.repoRootsList.mockReset();
    mocks.workspacesList.mockReset();
    useHarnessConnectionStore.getState().resetConnectionState();
  });

  it("does not cache empty workspace collections when a request is aborted", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    mocks.workspacesList.mockRejectedValueOnce(abortError);
    mocks.repoRootsList.mockResolvedValueOnce([]);
    const { result, queryClient } = renderUseWorkspaces();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(abortError);
    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(
      workspaceCollectionsKey("http://runtime.test", false),
    )).toBeUndefined();
  });

  it("keeps empty fallbacks for non-abort workspace collection failures", async () => {
    mocks.workspacesList.mockRejectedValueOnce(new Error("runtime unavailable"));
    mocks.repoRootsList.mockResolvedValueOnce([]);
    const { result } = renderUseWorkspaces();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.localWorkspaces).toEqual([]);
    expect(result.current.data?.repoRoots).toEqual([]);
  });

  it("errors when repo roots fail without a previous cache", async () => {
    const error = new Error("repo roots unavailable");
    mocks.workspacesList.mockResolvedValueOnce([]);
    mocks.repoRootsList.mockRejectedValueOnce(error);
    const { result, queryClient } = renderUseWorkspaces();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(error);
    expect(queryClient.getQueryData(
      workspaceCollectionsKey("http://runtime.test", false),
    )).toBeUndefined();
  });

  it("preserves previous repo roots when repo root refresh fails", async () => {
    const queryClient = createQueryClient();
    const workspace = makeWorkspace();
    const repoRoot = makeRepoRoot();
    queryClient.setQueryData(
      workspaceCollectionsKey("http://runtime.test", false),
      buildWorkspaceCollections([workspace], [repoRoot], []),
    );
    mocks.workspacesList.mockResolvedValueOnce([workspace]);
    mocks.repoRootsList.mockRejectedValueOnce(new Error("repo roots unavailable"));
    const { result } = renderUseWorkspaces(queryClient);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.repoRoots.map((entry) => entry.id)).toEqual(["repo-root-1"]);
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: result.current.data?.localWorkspaces ?? [],
      repoRoots: result.current.data?.repoRoots ?? [],
      cloudWorkspaces: [],
    });
    expect(logicalWorkspaces.map((entry) => entry.sourceRoot)).toEqual([
      "/Users/pablo/proliferate",
    ]);
  });

  it("does not attempt local inventory requests when only cloud is available", async () => {
    mocks.cloudActive = true;
    useHarnessConnectionStore.setState({
      runtimeUrl: "",
      connectionState: "connecting",
      error: null,
    });

    const { result } = renderUseWorkspaces();

    expect(mocks.workspacesList).not.toHaveBeenCalled();
    expect(mocks.repoRootsList).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isSuccess).toBe(false);
  });

  it("keeps seeded cloud workspace data available without a local runtime", () => {
    mocks.cloudActive = true;
    useHarnessConnectionStore.setState({
      runtimeUrl: "",
      connectionState: "connecting",
      error: null,
    });
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      workspaceCollectionsKey("", true, null),
      buildWorkspaceCollections([], [], [makeCloudWorkspace()]),
    );

    const { result } = renderUseWorkspaces(queryClient);

    expect(mocks.workspacesList).not.toHaveBeenCalled();
    expect(mocks.repoRootsList).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data?.cloudWorkspaces.map((workspace) => workspace.id)).toEqual([
      "cloud-1",
    ]);
  });

  it("continues loading local inventory when cloud is also active", async () => {
    mocks.cloudActive = true;
    mocks.workspacesList.mockResolvedValueOnce([]);
    mocks.repoRootsList.mockResolvedValueOnce([]);

    const { result } = renderUseWorkspaces();

    await waitFor(() => expect(mocks.workspacesList).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.repoRootsList).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.isSuccess).toBe(true);
  });
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderUseWorkspaces(queryClient = createQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    queryClient,
    ...renderHook(() => useWorkspaces(), { wrapper }),
  };
}

function makeWorkspace(): Workspace {
  return {
    id: "workspace-1",
    kind: "local",
    repoRootId: "repo-root-1",
    path: "/Users/pablo/proliferate",
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeRepoRoot(): RepoRoot {
  return {
    id: "repo-root-1",
    kind: "external",
    path: "/Users/pablo/proliferate",
    displayName: "proliferate",
    defaultBranch: "main",
    remoteProvider: "github",
    remoteOwner: "proliferate-ai",
    remoteRepoName: "proliferate",
    remoteUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeCloudWorkspace(): CloudWorkspaceSummary {
  return {
    id: "cloud-1",
    displayName: "Cloud workspace",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "main",
      baseBranch: "main",
    },
    status: "ready",
    workspaceStatus: "ready",
    runtime: {
      environmentId: "runtime-1",
      status: "running",
      generation: 1,
      actionBlockKind: null,
      actionBlockReason: null,
    },
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    actionBlockKind: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    readyAt: "2026-01-01T00:00:00.000Z",
    postReadyPhase: "complete",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
  };
}
