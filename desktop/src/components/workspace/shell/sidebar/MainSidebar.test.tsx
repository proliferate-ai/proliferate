/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import type { SupportMessageContext } from "@/lib/integrations/cloud/support";

const supportDialogRender = vi.hoisted(() => vi.fn());

vi.mock("@/components/support/SupportDialog", () => ({
  SupportDialog: (props: {
    onClose: () => void;
    context: SupportMessageContext;
  }) => {
    supportDialogRender(props);
    return (
      <div data-testid="support-dialog">
        <button type="button" onClick={props.onClose}>
          Close support
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/ui/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./SidebarFooter", () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer" />,
}));

vi.mock("./SidebarRowSurface", () => ({
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

vi.mock("@/components/ui/PopoverMenuItem", () => ({
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

vi.mock("@/components/ui/layout/AutoHideScrollArea", () => ({
  AutoHideScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/PopoverButton", () => ({
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

vi.mock("@/hooks/cloud/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false, cloudUnavailable: false }),
}));

vi.mock("@/hooks/cloud/use-cloud-billing", () => ({
  useCloudBilling: () => ({ data: null }),
}));

vi.mock("@/hooks/cloud/use-cloud-repo-configs", () => ({
  useCloudRepoConfigs: () => ({ data: { configs: [] }, isPending: false }),
}));

vi.mock("@/hooks/ui/use-debug-render-count", () => ({
  useDebugRenderCount: () => {},
}));

vi.mock("@/hooks/support/use-sidebar-support-context", () => ({
  useSidebarSupportContext: () => ({
    source: "sidebar",
    intent: "general",
    workspaceName: "hedgehog",
    workspaceLocation: "local",
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

vi.mock("@/hooks/workspaces/use-workspace-display-name-actions", () => ({
  useWorkspaceDisplayNameActions: () => ({ updateWorkspaceDisplayName: vi.fn() }),
}));

vi.mock("@/hooks/workspaces/use-workspace-sidebar-actions", () => ({
  useWorkspaceSidebarActions: () => ({
    handleAddRepo: vi.fn(),
    handleCreateCloudWorkspace: vi.fn(),
    handleCreateLocalWorkspace: vi.fn(),
    handleCreateWorktreeWorkspace: vi.fn(),
    handleGoAutomations: vi.fn(),
    handleGoHome: vi.fn(),
    handleGoPlugins: vi.fn(),
    handleMarkWorkspaceDone: vi.fn(),
    handleRetryWorkspaceCleanup: vi.fn(),
    handleSelectWorkspace: vi.fn(),
    handleSidebarIndicatorAction: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/use-sidebar-repo-group-state", () => ({
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

vi.mock("@/hooks/workspaces/use-workspace-sidebar-state", () => ({
  useWorkspaceSidebarState: () => ({
    groups: [],
    selectedWorkspaceId: null,
    selectedLogicalWorkspaceId: null,
    cleanupAttentionWorkspaces: [],
    emptyState: null,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/sessions/use-session-activity-reconciler", () => ({
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

describe("MainSidebar support mount boundary", () => {
  it("does not mount SupportDialog until Support is opened", async () => {
    renderMainSidebar();

    expect(supportDialogRender).not.toHaveBeenCalled();
    expect(screen.queryByTestId("support-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Support" }));

    expect(supportDialogRender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("support-dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close support" }));

    await waitFor(() => {
      expect(screen.queryByTestId("support-dialog")).toBeNull();
    });
  });
});
