/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";

const openSupportReportWindow = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/access/tauri/support", () => ({
  openSupportReportWindow,
}));

vi.mock("@/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./SidebarFooter", () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer" />,
}));

vi.mock("@proliferate/ui/layout/SidebarRowSurface", () => ({
  SidebarRowSurface: ({
    active,
    children,
    onPress,
  }: {
    active?: boolean;
    children: ReactNode;
    onPress?: () => void;
  }) => (
    <button type="button" data-active={String(!!active)} onClick={onPress}>
      {children}
    </button>
  ),
}));

vi.mock("./SidebarActionButton", () => ({
  SidebarActionButton: ({
    children,
    onClick,
    title,
  }: {
    children: ReactNode;
    onClick?: () => void;
    title: string;
  }) => (
    <button type="button" aria-label={title} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("./SidebarWorkspaceVariantIcon", () => ({
  SidebarWorkspaceVariantIcon: () => <span data-testid="workspace-variant-icon" />,
}));

vi.mock("./SidebarWorkspaceContent", () => ({
  SidebarWorkspaceContent: () => <div data-testid="sidebar-workspace-content" />,
}));

vi.mock("./WorkspaceCleanupAttentionSection", () => ({
  WorkspaceCleanupAttentionSection: () => <div data-testid="cleanup-attention" />,
}));

vi.mock("@/components/workspace/cowork/sidebar/CoworkThreadsSection", () => ({
  CoworkThreadsSection: () => <div data-testid="cowork-threads" />,
}));

vi.mock("@proliferate/ui/primitives/PopoverMenuItem", () => ({
  PopoverMenuItem: ({
    label,
    onClick,
  }: {
    label: string;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock("@proliferate/ui/layout/AutoHideScrollArea", () => ({
  AutoHideScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@proliferate/ui/primitives/PopoverButton", () => ({
  PopoverButton: ({
    children,
    trigger,
  }: {
    children: () => ReactNode;
    trigger: ReactNode;
  }) => (
    <div>
      {trigger}
      {children()}
    </div>
  ),
}));

vi.mock("@/components/workspace/repo-setup/RepoSetupModal", () => ({
  RepoSetupModal: () => <div data-testid="repo-setup-modal" />,
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false, cloudUnavailable: false }),
}));

vi.mock("@/hooks/cloud/facade/use-cloud-billing", () => ({
  useCloudBilling: () => ({ data: null }),
}));

vi.mock("@/hooks/access/cloud/use-cloud-repo-configs", () => ({
  useCloudRepoConfigs: () => ({ data: { configs: [] }, isPending: false }),
}));

vi.mock("@/hooks/ui/debug/use-debug-render-count", () => ({
  useDebugRenderCount: () => {},
}));

vi.mock("@/hooks/workspaces/derived/use-sidebar-shortcut-targets", () => ({
  useSidebarShortcutTargets: () => [],
}));

vi.mock("@/hooks/support/derived/use-support-report-snapshot", () => ({
  useSupportReportSnapshot: () => ({
    openedAt: "2026-05-30T00:00:00.000Z",
    source: "sidebar",
    context: {
      source: "sidebar",
      intent: "general",
      workspaceName: "hedgehog",
      workspaceLocation: "local",
    },
    defaultScope: "app_only",
    defaultWorkspaceId: null,
    workspaceOptions: [],
  }),
}));

vi.mock("@/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { pendingWorkspaceEntry: null }) => unknown) =>
    selector({ pendingWorkspaceEntry: null }),
}));

const workspaceUiState = vi.hoisted(() => ({
  archiveWorkspace: vi.fn(),
  hideRepoRoot: vi.fn(),
  unarchiveWorkspace: vi.fn(),
  unarchiveWorkspaces: vi.fn(),
  workspaceTypes: ["local", "worktree", "cloud"],
  toggleSidebarWorkspaceType: vi.fn(),
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: typeof workspaceUiState) => unknown) =>
    selector(workspaceUiState),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-display-name-actions", () => ({
  useWorkspaceDisplayNameActions: () => ({ updateWorkspaceDisplayName: vi.fn() }),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-sidebar-actions", () => ({
  useWorkspaceSidebarActions: () => ({
    handleAddRepo: vi.fn(),
    handleCreateCloudWorkspace: vi.fn(),
    handleCreateLocalWorkspace: vi.fn(),
    handleCreateWorktreeWorkspace: vi.fn(),
    handleGoAutomations: vi.fn(),
    handleGoHome: vi.fn(),
    handleGoPlugins: vi.fn(),
    handleGoWorkspaces: vi.fn(),
    handleMarkWorkspaceDone: vi.fn(),
    handleRetryWorkspaceCleanup: vi.fn(),
    handleSelectWorkspace: vi.fn(),
    handleSidebarIndicatorAction: vi.fn(),
  }),
}));

vi.mock("@/hooks/cloud/workflows/use-cloud-workspace-actions", () => ({
  useCloudWorkspaceActions: () => ({
    archiveCloudWorkspace: vi.fn(),
    restoreCloudWorkspace: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({
  useWorkspaceCollectionsInvalidation: () => vi.fn(),
}));

vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: { runtimeUrl: string }) => unknown) =>
    selector({ runtimeUrl: "http://127.0.0.1:8482" }),
}));

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({
  archiveCloudWorkspace: vi.fn(),
  restoreCloudWorkspace: vi.fn(),
}));

vi.mock("@/hooks/workspaces/facade/use-sidebar-repo-group-state", () => ({
  useSidebarRepoGroupState: () => ({
    allRepoKeys: [],
    allRepoGroupsCollapsed: false,
    collapsedRepoGroupKeys: new Set<string>(),
    repoGroupsShownMoreKeys: new Set<string>(),
    handleToggleRepoShowMore: vi.fn(),
    handleToggleRepoCollapsed: vi.fn(),
    handleToggleAllRepoGroups: vi.fn(),
    clearRepoGroupShowMore: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-sidebar-state", () => ({
  useWorkspaceSidebarState: () => ({
    groups: [],
    selectedWorkspaceId: null,
    selectedLogicalWorkspaceId: null,
    cleanupAttentionWorkspaces: [],
    emptyState: null,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/sessions/lifecycle/use-session-activity-reconciler", () => ({
  useSessionActivityReconciler: () => {},
}));

const repoSetupModalState = vi.hoisted(() => ({
  modal: null,
  close: vi.fn(),
}));

vi.mock("@/stores/ui/repo-setup-modal-store", () => ({
  useRepoSetupModalStore: (selector: (state: typeof repoSetupModalState) => unknown) =>
    selector(repoSetupModalState),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMainSidebar() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <MainSidebar />
    </MemoryRouter>,
  );
}

describe("MainSidebar support window", () => {
  it("opens the support report window from Support", async () => {
    renderMainSidebar();

    fireEvent.click(screen.getByRole("button", { name: /Support/ }));

    await waitFor(() => {
      expect(openSupportReportWindow).toHaveBeenCalledTimes(1);
    });
  });
});
