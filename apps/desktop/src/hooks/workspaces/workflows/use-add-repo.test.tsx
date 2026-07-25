// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoRoot } from "@anyharness/sdk";

const mocks = vi.hoisted(() => ({
  getAnonymousInstallId: vi.fn(),
  saveEnvironment: vi.fn(),
  runAddRepoWorkflow: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: {
      runtime: {},
      identity: {
        getAnonymousInstallId: mocks.getAnonymousInstallId,
      },
    },
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useResolveRepoRootFromPathMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useSaveRepoEnvironment: () => ({ mutateAsync: mocks.saveEnvironment }),
}));

vi.mock("@/lib/domain/workspaces/creation/add-repo-workflow", () => ({
  runAddRepoWorkflow: mocks.runAddRepoWorkflow,
}));

vi.mock("@/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({
  useWorkspaceCollectionsInvalidationActions: () => ({
    invalidateWorkspaceCollectionsForRuntime: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/cache/use-workspace-collections-mutation-cache", () => ({
  useWorkspaceCollectionsMutationCacheActions: () => ({
    upsertRepoRootInWorkspaceCollections: vi.fn(),
  }),
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: { unhideRepoRoot: () => void }) => unknown) =>
    selector({ unhideRepoRoot: vi.fn() }),
}));

vi.mock("@/stores/ui/repo-setup-modal-store", () => ({
  useRepoSetupModalStore: (selector: (state: { open: () => void }) => unknown) =>
    selector({ open: vi.fn() }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

vi.mock("@/hooks/workspaces/workflows/runtime-ready", () => ({
  ensureRuntimeReady: vi.fn(),
}));

import { useAddRepo } from "./use-add-repo";

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useAddRepo local environment identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAnonymousInstallId.mockResolvedValue("anonymous-install-1");
    mocks.saveEnvironment.mockResolvedValue(undefined);
    mocks.runAddRepoWorkflow.mockImplementation(async (input) => {
      const repoRoot = {
        id: "repo-root-1",
        path: "/repo",
        displayName: "repo",
        remoteProvider: "github",
        remoteOwner: "proliferate-ai",
        remoteRepoName: "proliferate",
        defaultBranch: "main",
      } as RepoRoot;
      input.saveLocalRepoEnvironment?.(repoRoot);
      return repoRoot;
    });
  });

  afterEach(cleanup);

  it("registers the local environment with the host-provided anonymous install id", async () => {
    const { result } = renderHook(() => useAddRepo(), { wrapper });

    await act(async () => {
      await result.current.addRepoFromPath("/repo");
    });

    await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledTimes(1));
    expect(mocks.getAnonymousInstallId).toHaveBeenCalledTimes(1);
    expect(mocks.saveEnvironment).toHaveBeenCalledWith({
      gitOwner: "proliferate-ai",
      gitRepoName: "proliferate",
      body: {
        kind: "local",
        gitProvider: "github",
        desktopInstallId: "anonymous-install-1",
        localPath: "/repo",
        defaultBranch: "main",
        setupScript: "",
        runCommand: "",
      },
    });
  });
});
