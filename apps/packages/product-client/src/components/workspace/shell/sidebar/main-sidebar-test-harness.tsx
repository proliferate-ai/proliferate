/* @vitest-environment jsdom */

// Shared render harness + mock state for the MainSidebar suite, split across
// MainSidebar.test.tsx and MainSidebar.cloud-gating.test.tsx to stay under the
// max-lines gate. This module is NOT a test file: it holds no `vi.mock` calls
// of its own, because vitest only hoists `vi.mock` within the file that
// declares it. Each spec file still declares its own (thin) `vi.mock` wrappers
// that read/write the hoisted state exported here.
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { MainSidebar } from "#product/components/workspace/shell/sidebar/MainSidebar";
import type { SidebarWorkspaceItemState } from "#product/lib/domain/workspaces/sidebar/sidebar-model";
import { clearShortcutHandlerRegistryForTests } from "#product/lib/domain/shortcuts/registry";

export const releaseNoticeState = {
  notice: null as null | {
    version: string;
    title: string;
  },
  dismissNotice: vi.fn(),
  openChangelog: vi.fn(),
};

export const sidebarActionMocks = {
  handleAddRepo: vi.fn(),
  handleCreateCloudWorkspace: vi.fn(),
  handleCreateLocalWorkspace: vi.fn(),
  handleCreateWorktreeWorkspace: vi.fn(),
  handleGoHome: vi.fn(),
  handleGoHomeForRepository: vi.fn(),
  handleGoWorkflows: vi.fn(),
  handleGoWorkspaces: vi.fn(),
  handleMarkWorkspaceDone: vi.fn(),
  handleOpenPullRequest: vi.fn(),
  handleSelectWorkspace: vi.fn(),
  handleSidebarIndicatorAction: vi.fn(),
};

export const workspaceSidebarState = {
  groups: [] as Array<{
    sourceRoot: string;
    items: Array<{
      active: boolean;
      id?: string;
      localWorkspaceId?: string | null;
      cloudWorkspaceId?: string | null;
      name?: string;
    }>;
  }>,
  pinnedItems: [] as unknown[],
  selectedWorkspaceId: null as string | null,
  selectedLogicalWorkspaceId: null as string | null,
  emptyState: null,
  isLoading: false,
};

export const cloudAvailabilityState = {
  cloudActive: false,
  cloudUnavailable: false,
  authStatus: "authenticated" as string,
  cloudComputeEnabled: true,
};

export const productHostState = {
  desktop: null as object | null,
  clipboard: { writeText: () => Promise.resolve() },
};

export const workspaceUiState = {
  archiveWorkspace: vi.fn(),
  hideRepoRoot: vi.fn(),
  sidebarOpen: true,
  unarchiveWorkspace: vi.fn(),
  unarchiveWorkspaces: vi.fn(),
  pinWorkspace: vi.fn(),
  unpinWorkspace: vi.fn(),
  workspaceTypes: ["local", "worktree", "cloud"],
  toggleSidebarWorkspaceType: vi.fn(),
  repositoriesCollapsed: false,
  setRepositoriesCollapsed: vi.fn(),
};

export const workspaceArchiveActionsMock = {
  archive: vi.fn(),
  unarchive: vi.fn(),
  optimisticallyArchivedIds: new Set<string>(),
  scenario: null as null | { workspaceId: string },
  dismissScenario: vi.fn(),
};

export const toastShowMock = vi.fn();

// The workflows_v2 launch gate, held mutable so the sidebar is covered with
// gen-2 both dark and live rather than only at the current default.
export const workflowsGateState = { enabled: true };

// A sidebar item's `id` is the LOGICAL workspace id; the runtime archive and
// unarchive verbs address the UUID `localWorkspaceId` carries. Distinct here,
// so handing a logical id to a runtime verb fails loudly.
export const LOGICAL_ID = "remote:github:proliferate-ai:proliferate:fledgling";
export const RUNTIME_ID = "1f0b6a4c-6f1f-4f1a-9b2e-2c5f7f3a1d44";

export function resetMainSidebarTestState(): void {
  cleanup();
  clearShortcutHandlerRegistryForTests();
  vi.clearAllMocks();
  releaseNoticeState.notice = null;
  productHostState.desktop = null;
  workspaceUiState.sidebarOpen = true;
  workspaceSidebarState.groups = [];
  workspaceSidebarState.pinnedItems = [];
  workspaceSidebarState.selectedWorkspaceId = null;
  workspaceSidebarState.selectedLogicalWorkspaceId = null;
  workspaceArchiveActionsMock.optimisticallyArchivedIds = new Set<string>();
  workspaceArchiveActionsMock.scenario = null;
  cloudAvailabilityState.cloudActive = false;
  cloudAvailabilityState.cloudUnavailable = false;
  cloudAvailabilityState.authStatus = "authenticated";
  cloudAvailabilityState.cloudComputeEnabled = true;
  workflowsGateState.enabled = true;
}

export function makePinnedItemState(
  overrides: Partial<SidebarWorkspaceItemState> = {},
): SidebarWorkspaceItemState {
  return {
    id: "ws-pinned",
    localWorkspaceId: null,
    cloudWorkspaceId: null,
    name: "Pinned workspace",
    defaultName: "Pinned workspace",
    hasDisplayNameOverride: false,
    renameSupported: false,
    subtitle: null,
    active: false,
    archived: false,
    pinnedIds: ["ws-pinned"],
    variant: "worktree",
    statusIndicator: null,
    lastInteracted: null,
    needsReview: false,
    workspaceLocationCopyLabel: null,
    workspaceLocationCopyValue: null,
    workspaceLocationCopyToastLabel: null,
    branchName: null,
    sessionCount: null,
    gitStatus: null,
    availabilityCommands: [],
    cloudWorkspaceIdForActions: null,
    linkedMaterializationId: null,
    repoOwner: null,
    repoName: null,
    ...overrides,
  };
}

export function renderMainSidebar(): RenderResult {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <MainSidebar />
    </MemoryRouter>,
  );
}
