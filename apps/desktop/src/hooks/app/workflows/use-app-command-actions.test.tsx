// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppCommandActions } from "@/hooks/app/workflows/use-app-command-actions";

const hookMocks = vi.hoisted(() => ({
  copyBranchName: vi.fn(),
  copyWorkspaceLocation: vi.fn(),
  createCloudWorkspaceAndEnter: vi.fn(() => Promise.resolve()),
  createLocalWorkspaceAndEnter: vi.fn(() => Promise.resolve()),
  createWorktreeAndEnter: vi.fn(() => Promise.resolve()),
  goToTopLevelRoute: vi.fn(),
  navigateToWorkspaceShell: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  selectedWorkspaceId: null as string | null,
  selectedLogicalWorkspace: null as unknown,
  activeNewWorkspaceScope: null as unknown,
  homeTargetSelection: {
    destination: "repository",
    repositorySelection: { kind: "repository", sourceRoot: "/repo-b" },
    repoLaunchKind: "worktree",
    selectedSshTargetId: null,
    baseBranchOverride: "stale/from-other-repo",
  },
  homeRepositorySelection: {
    selectedRepository: {
      sourceRoot: "/repo-b",
      name: "Repo B",
      secondaryLabel: null,
      workspaceCount: 1,
      repoRootId: "repo-root-b",
      localWorkspaceId: "workspace-local-b",
      gitProvider: "github",
      gitOwner: "proliferate-ai",
      gitRepoName: "repo-b",
    },
    selectedBranchName: "main",
    defaultBranchName: "main",
  },
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: true }),
}));

vi.mock("@/hooks/cloud/facade/use-cloud-billing", () => ({
  useCloudBilling: () => ({ data: null }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: () => ({
    data: {
      repositories: [{
        id: "repo-config-1",
        gitProvider: "github",
        gitOwner: "proliferate-ai",
        gitRepoName: "repo-b",
        environments: [{
          id: "repo-environment-1",
          repoConfigId: "repo-config-1",
          kind: "cloud",
          desktopInstallId: null,
          localPath: null,
          defaultBranch: "main",
          setupScript: "",
          runCommand: "",
        }],
      }],
    },
    isPending: false,
  }),
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({
    openExternal: hookMocks.openExternal,
  }),
}));

vi.mock("@/hooks/cloud/workflows/use-create-cloud-workspace", () => ({
  useCreateCloudWorkspace: () => ({
    createCloudWorkspaceAndEnter: hookMocks.createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace: false,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-selected-logical-workspace", () => ({
  useSelectedLogicalWorkspace: () => ({
    selectedLogicalWorkspace: hookMocks.selectedLogicalWorkspace,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-standard-repo-projection", () => ({
  useStandardRepoProjection: () => ({
    repoRoots: [],
    localWorkspaces: [],
    cloudWorkspaces: [],
  }),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-entry-actions", () => ({
  useWorkspaceEntryActions: () => ({
    createLocalWorkspaceAndEnter: hookMocks.createLocalWorkspaceAndEnter,
    isCreatingLocalWorkspace: false,
    createWorktreeAndEnter: hookMocks.createWorktreeAndEnter,
    isCreatingWorktreeWorkspace: false,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/use-add-repo", () => ({
  useAddRepo: () => ({
    canAddRepo: true,
    addRepoDisabledReason: null,
    isAddingRepo: false,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-copy-actions", () => ({
  useWorkspaceCopyActions: () => ({
    copyWorkspaceLocation: hookMocks.copyWorkspaceLocation,
    copyBranchName: hookMocks.copyBranchName,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    goToTopLevelRoute: hookMocks.goToTopLevelRoute,
    navigateToWorkspaceShell: hookMocks.navigateToWorkspaceShell,
  }),
}));

vi.mock("@/hooks/home/ui/use-home-next-target-selection-state", () => ({
  useHomeNextTargetSelectionSnapshot: () => hookMocks.homeTargetSelection,
}));

vi.mock("@/hooks/home/derived/use-home-next-repository-selection", () => ({
  useHomeNextRepositorySelection: () => hookMocks.homeRepositorySelection,
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: string | null }) => unknown) =>
    selector({ selectedWorkspaceId: hookMocks.selectedWorkspaceId }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: hookMocks.showToast }),
}));

vi.mock("@/stores/workspaces/new-workspace-command-scope-store", () => ({
  useNewWorkspaceCommandScopeStore: (
    selector: (state: { activeScope: unknown }) => unknown,
  ) => selector({ activeScope: hookMocks.activeNewWorkspaceScope }),
}));

vi.mock("@/lib/infra/measurement/latency-flow", () => ({
  failLatencyFlow: vi.fn(),
  startLatencyFlow: vi.fn(() => "latency-flow-1"),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>;
}

describe("useAppCommandActions", () => {
  beforeEach(() => {
    hookMocks.copyBranchName.mockClear();
    hookMocks.copyWorkspaceLocation.mockClear();
    hookMocks.createCloudWorkspaceAndEnter.mockClear();
    hookMocks.createLocalWorkspaceAndEnter.mockClear();
    hookMocks.createWorktreeAndEnter.mockClear();
    hookMocks.goToTopLevelRoute.mockClear();
    hookMocks.navigateToWorkspaceShell.mockClear();
    hookMocks.openExternal.mockClear();
    hookMocks.showToast.mockClear();
    hookMocks.selectedWorkspaceId = null;
    hookMocks.activeNewWorkspaceScope = null;
    hookMocks.homeTargetSelection.baseBranchOverride = "stale/from-other-repo";
    hookMocks.homeRepositorySelection.selectedBranchName = "main";
  });

  afterEach(() => {
    cleanup();
  });

  it("uses Home's resolved visible branch for new worktree shortcuts", () => {
    const { result } = renderHook(() => useAppCommandActions(), { wrapper });

    act(() => {
      result.current.newWorktreeWorkspace.execute("shortcut");
    });

    expect(hookMocks.navigateToWorkspaceShell).toHaveBeenCalledTimes(1);
    expect(hookMocks.createWorktreeAndEnter).toHaveBeenCalledWith({
      repoRootId: "repo-root-b",
      sourceWorkspaceId: "workspace-local-b",
      baseBranch: "main",
      defaultBranch: "main",
    }, expect.objectContaining({
      latencyFlowId: "latency-flow-1",
      repoGroupKeyToExpand: "/repo-b",
    }));
  });

  it("opens the web app with the configured base URL", () => {
    const { result } = renderHook(() => useAppCommandActions(), { wrapper });

    act(() => {
      result.current.openWebApp.execute("shortcut");
    });

    expect(hookMocks.openExternal).toHaveBeenCalledWith("https://web.proliferate.com");
    expect(hookMocks.showToast).toHaveBeenCalledWith("Opening web app...", "info");
  });
});
