// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessError, type Workspace } from "@anyharness/sdk";
import { workspaceCollectionsKey } from "#product/hooks/workspaces/cache/query-keys";
import { useWorktreeMissingActions } from "#product/hooks/workspaces/workflows/use-worktree-missing-actions";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  restorePending: false,
  refresh: vi.fn(async () => undefined),
  showToast: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useRestoreWorktreeWorkspaceMutation: () => ({
    mutateAsync: mocks.restore,
    isPending: mocks.restorePending,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({
  useWorkspaceCollectionsInvalidation: () => mocks.refresh,
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string }) => unknown,
  ) => selector({ runtimeUrl: "http://localhost:7007" }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof mocks.showToast }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

beforeEach(() => {
  mocks.restorePending = false;
  mocks.restore.mockResolvedValue({ outcome: "restored" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorktreeMissingActions", () => {
  it("restores the existing workspace, refreshes collections, and reports success", async () => {
    const { result } = renderActions();

    let restored = false;
    await act(async () => {
      restored = await result.current.restoreWorktree();
    });

    expect(restored).toBe(true);
    expect(mocks.restore).toHaveBeenCalledWith("workspace-1");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith("Worktree restored.");
    expect(result.current.restoreError).toBeNull();
  });

  it("translates typed path failures without refreshing collections", async () => {
    mocks.restore.mockRejectedValueOnce(new AnyHarnessError({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      detail: "occupied path",
      code: "WORKTREE_RESTORE_PATH_OCCUPIED",
    }));
    const { result } = renderActions();

    let restored = true;
    await act(async () => {
      restored = await result.current.restoreWorktree();
    });

    expect(restored).toBe(false);
    expect(result.current.restoreError).toMatch(/will not overwrite it/i);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("exposes mutation progress to disable duplicate UI actions", () => {
    mocks.restorePending = true;
    const { result } = renderActions();

    expect(result.current.isRestoring).toBe(true);
  });

  it("reports a still-missing folder after checking again", async () => {
    const { result } = renderActions();
    seedCollections("workspace_directory_missing");

    await act(async () => {
      await result.current.checkAgain();
    });

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith("Checked again. Worktree folder is still missing.");
  });

  it("stays silent when checking again finds the folder restored", async () => {
    const { result } = renderActions();
    seedCollections("available");

    await act(async () => {
      await result.current.checkAgain();
    });

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

let queryClient: QueryClient;

function renderActions() {
  queryClient = new QueryClient();
  return renderHook(() => useWorktreeMissingActions({ workspaceId: "workspace-1" }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function seedCollections(availability: Workspace["availability"]) {
  queryClient.setQueryData(workspaceCollectionsKey("http://localhost:7007", false, null), {
    localWorkspaces: [],
    retiredLocalWorkspaces: [],
    repoRoots: [],
    cloudWorkspaces: [],
    workspaces: [],
    allWorkspaces: [
      { id: "workspace-1", kind: "worktree", availability } as unknown as Workspace,
    ],
    cleanupAttentionWorkspaces: [],
  });
}
