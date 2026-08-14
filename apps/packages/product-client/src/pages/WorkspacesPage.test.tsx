// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { AppCommandActions } from "#product/hooks/app/workflows/app-command-action-types";
import { setAppNavigate } from "#product/lib/workflows/app/app-navigate-handoff";
import { WorkspacesPage } from "#product/pages/WorkspacesPage";
import { AppCommandActionsProvider } from "#product/providers/AppCommandActionsProvider";
import {
  readHomeNextTargetSelectionState,
  resetHomeNextTargetSelectionForTests,
} from "#product/hooks/home/ui/use-home-next-target-selection-state";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => ({
  createCloudWorkspaceAndEnter: vi.fn(),
  createLocalWorkspaceAndEnter: vi.fn(),
  createWorktreeAndEnter: vi.fn(),
  openWorkspaceSession: vi.fn(),
  retireWorkspace: vi.fn(),
  retryCleanup: vi.fn(),
  selectWorkspace: vi.fn(),
  newWorktreeCommand: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: () => ({ data: { repositories: [] } }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: {},
    links: { openExternal: vi.fn() },
  }),
}));

vi.mock("#product/components/workspace/shell/screen/MainSidebarPageShell", () => ({
  MainSidebarPageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false }),
}));

vi.mock("#product/hooks/cloud/workflows/use-create-cloud-workspace", () => ({
  useCreateCloudWorkspace: () => ({
    createCloudWorkspaceAndEnter: mocks.createCloudWorkspaceAndEnter,
    isCreatingCloudWorkspace: false,
  }),
}));

vi.mock("#product/hooks/capabilities/derived/use-web-app-target", () => ({
  useWebAppTarget: () => ({ available: false, baseUrl: null }),
}));

vi.mock("#product/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({ logicalWorkspaces: [] }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-git-statuses", () => ({
  useWorkspaceGitStatuses: () => ({ syncByLogicalId: {} }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-sidebar-state", () => ({
  useWorkspaceSidebarState: () => ({ groups: [] }),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({ openWorkspaceSession: mocks.openWorkspaceSession }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-entry-actions", () => ({
  useWorkspaceEntryActions: () => ({
    createLocalWorkspaceAndEnter: mocks.createLocalWorkspaceAndEnter,
    createWorktreeAndEnter: mocks.createWorktreeAndEnter,
    isCreatingWorktreeWorkspace: false,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-retire-actions", () => ({
  useWorkspaceRetireActions: () => ({
    markDone: mocks.retireWorkspace,
    retryCleanup: mocks.retryCleanup,
  }),
}));

function action(execute = vi.fn()): AppCommandActions["goHome"] {
  return { execute, disabledReason: null };
}

function appCommands(): AppCommandActions {
  return {
    openSettings: action(),
    showKeyboardShortcuts: action(),
    goHome: action(),
    goWorkflows: action(),
    openWebApp: action(),
    openSupport: action(),
    addRepository: action(),
    newLocalWorkspace: action(),
    newWorktreeWorkspace: action(mocks.newWorktreeCommand),
    newCloudWorkspace: action(),
    copyWorkspacePath: action(),
    copyBranchName: action(),
  };
}

beforeAll(() => {
  // cmdk keeps its active item visible; jsdom has no layout implementation.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetHomeNextTargetSelectionForTests();
  useSessionSelectionStore.getState().clearSelection();
});

afterEach(() => {
  cleanup();
});

// Mirrors AuthenticatedAppHost, which registers the router navigate for
// callback-only `navigateApp` consumers like goToTopLevelRoute.
function RegisterAppNavigate() {
  const navigate = useNavigate();
  useEffect(() => {
    setAppNavigate(navigate);
    return () => setAppNavigate(null);
  }, [navigate]);
  return null;
}

describe("WorkspacesPage creation", () => {
  it("enters Home's repository worktree flow before creating a workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/workspaces"]}>
        <RegisterAppNavigate />
        <AppCommandActionsProvider value={appCommands()}>
          <Routes>
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/" element={<p>Home repository launch</p>} />
          </Routes>
        </AppCommandActionsProvider>
      </MemoryRouter>,
    );

    expect(readHomeNextTargetSelectionState()).toMatchObject({
      destination: "cowork",
      repoLaunchKind: "worktree",
    });

    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => {
      expect(screen.getByText("Home repository launch")).toBeTruthy();
    });
    expect(readHomeNextTargetSelectionState()).toMatchObject({
      destination: "repository",
      repoLaunchKind: "worktree",
    });
    expect(mocks.createWorktreeAndEnter).not.toHaveBeenCalled();
    expect(mocks.newWorktreeCommand).not.toHaveBeenCalled();
  });
});
