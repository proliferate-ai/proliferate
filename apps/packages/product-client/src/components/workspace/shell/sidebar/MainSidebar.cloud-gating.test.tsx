/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSupportModalStore } from "#product/stores/support/support-modal-store";
import {
  cloudAvailabilityState,
  productHostState,
  releaseNoticeState,
  renderMainSidebar,
  resetMainSidebarTestState,
  sidebarActionMocks,
  workspaceArchiveActionsMock,
  workspaceSidebarState,
  workspaceUiState,
} from "./main-sidebar-test-harness";

vi.mock("#product/hooks/updates/facade/use-release-notice", () => ({ useReleaseNotice: () => releaseNoticeState }));
vi.mock("#product/components/diagnostics/DebugProfiler", () => ({ DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("#product/components/app/sidebar/SidebarAccountFooter", () => ({ SidebarAccountFooter: () => <div data-testid="sidebar-account-footer" /> }));
vi.mock("#product/primitives/patterns/sidebar/SidebarRowSurface", () => ({
  SidebarRowSurface: ({ active, children, onPress }: { active?: boolean; children: ReactNode; onPress?: () => void }) => (
    <div role="button" tabIndex={0} data-active={String(!!active)} onClick={onPress}>{children}</div>
  ),
}));
vi.mock("#product/primitives/patterns/sidebar/SidebarActionButton", () => ({
  SidebarActionButton: ({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title: string }) => (
    <button type="button" aria-label={title} onClick={onClick}>{children}</button>
  ),
}));
vi.mock("./SidebarWorkspaceVariantIcon", () => ({ SidebarWorkspaceVariantIcon: () => <span data-testid="workspace-variant-icon" /> }));

// Rows come from the groups MainSidebar actually hands down (i.e. after its
// optimistic-hide filter), and each row forwards `item.id` exactly as the
// real SidebarWorkspaceContent does — the id space crossing this boundary is
// the thing under test.
vi.mock("./SidebarWorkspaceContent", () => ({
  SidebarWorkspaceContent: ({ groups, onNewChatForRepository, onArchiveWorkspace, onUnarchiveWorkspace, cloudWorkspaceEnabled }: {
    groups: Array<{ items: Array<{ id?: string; name?: string }> }>;
    onNewChatForRepository: (sourceRoot: string) => void;
    onArchiveWorkspace: (workspaceId: string) => void;
    onUnarchiveWorkspace: (workspaceId: string) => void;
    cloudWorkspaceEnabled: boolean;
  }) => (
    <div data-testid="sidebar-workspace-content" data-cloud-workspace-enabled={String(cloudWorkspaceEnabled)}>
      <button type="button" onClick={() => onNewChatForRepository("/repo-a")}>New chat in Repo A</button>
      {groups.flatMap((group) => group.items).filter((item) => !!item.id).map((item) => (
        <div key={item.id} data-testid={`sidebar-row-${item.id}`}>
          <button type="button" onClick={() => onArchiveWorkspace(item.id!)}>{`Archive ${item.name}`}</button>
          <button type="button" onClick={() => onUnarchiveWorkspace(item.id!)}>{`Unarchive ${item.name}`}</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("#product/components/workspace/cowork/sidebar/CoworkThreadsSection", () => ({ CoworkThreadsSection: () => <div data-testid="cowork-threads" /> }));
vi.mock("#product/primitives/PopoverMenuItem", () => ({
  PopoverMenuItem: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
}));
vi.mock("#product/primitives/patterns/AutoHideScrollArea", () => ({
  AutoHideScrollArea: ({ children }: { children: ReactNode }) => <div data-testid="sidebar-scroll-area">{children}</div>,
}));

// The PopoverButton mock below renders every popover body eagerly, so the
// Repositories header's add-repository flow would mount its whole data layer
// in a sidebar test.
vi.mock("#product/components/workspace/repo-setup/AddRepositoryFlowPanel", () => ({ AddRepositoryFlowPanel: () => null }));
vi.mock("#product/primitives/PopoverButton", () => ({
  POPOVER_SURFACE_CLASS: "",
  PopoverButton: ({ children, trigger }: { children: () => ReactNode; trigger: ReactNode }) => (
    <div>{trigger}{children()}</div>
  ),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({ useCloudAvailabilityState: () => cloudAvailabilityState }));
vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({ useAppCapabilities: () => ({ managedCloudStatus: "disabled" }) }));
vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({ useProductHost: () => productHostState }));
vi.mock("#product/hooks/workspaces/workflows/use-add-repo", () => ({ useAddRepo: () => ({ addRepoFromPath: vi.fn(), isAddingRepo: false }) }));
vi.mock("#product/hooks/cloud/facade/use-cloud-billing", () => ({ useCloudBilling: () => ({ data: null }) }));
vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRemoveCloudRepoEnvironment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRepositories: () => ({ data: { repositories: [] }, isPending: false }),
}));
vi.mock("#product/hooks/ui/debug/use-debug-render-count", () => ({ useDebugRenderCount: () => {} }));
vi.mock("#product/hooks/workspaces/derived/use-sidebar-shortcut-targets", () => ({
  useSidebarShortcutTargets: () => ({ digitTargetIds: [], traversalTargetIds: [] }),
}));
vi.mock("#product/hooks/support/derived/use-support-report-snapshot", () => ({
  useSupportReportSnapshot: () => ({
    openedAt: "2026-05-30T00:00:00.000Z",
    source: "sidebar",
    context: { source: "sidebar", intent: "general", workspaceName: "hedgehog", workspaceLocation: "local" },
    defaultScope: "app_only",
    defaultWorkspaceId: null,
    workspaceOptions: [],
  }),
}));
vi.mock("#product/hooks/support/workflows/use-open-support-report-window", () => ({
  useOpenSupportReportWindow: () => ({
    openBug: vi.fn(() => { useSupportModalStore.getState().openFeedback(); }),
    openFeature: vi.fn(),
    canSubmit: true,
    disabledReason: null,
  }),
}));
vi.mock("#product/hooks/support/facade/use-support-availability", () => ({ useSupportAvailability: () => ({ canSubmit: true, disabledReason: null }) }));
vi.mock("#product/hooks/workspaces/derived/use-pending-workspace-entries", () => ({ useAttendedPendingWorkspaceEntry: () => null }));
vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: typeof workspaceUiState) => unknown) => selector(workspaceUiState),
}));
vi.mock("#product/hooks/workspaces/workflows/use-workspace-display-name-actions", () => ({ useWorkspaceDisplayNameActions: () => ({ updateWorkspaceDisplayName: vi.fn() }) }));
vi.mock("#product/hooks/workspaces/workflows/use-workspace-sidebar-actions", () => ({ useWorkspaceSidebarActions: () => sidebarActionMocks }));
vi.mock("#product/hooks/cloud/workflows/use-cloud-workspace-actions", () => ({
  useCloudWorkspaceActions: () => ({ archiveCloudWorkspace: vi.fn(), restoreCloudWorkspace: vi.fn() }),
}));
vi.mock("#product/providers/WorkspaceArchiveActionsProvider", () => ({ useWorkspaceArchiveActionsContext: () => workspaceArchiveActionsMock }));
vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({ useWorkspaceCollectionsInvalidation: () => vi.fn() }));
vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: { runtimeUrl: string }) => unknown) => selector({ runtimeUrl: "http://127.0.0.1:8482" }),
}));
vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({ archiveCloudWorkspace: vi.fn(), restoreCloudWorkspace: vi.fn() }));
vi.mock("#product/hooks/workspaces/facade/use-sidebar-repo-group-state", () => ({
  useSidebarRepoGroupState: () => ({
    collapsedRepoGroupKeys: new Set<string>(),
    repoGroupsShownMoreKeys: new Set<string>(),
    handleToggleRepoShowMore: vi.fn(),
    handleToggleRepoCollapsed: vi.fn(),
    clearRepoGroupShowMore: vi.fn(),
  }),
}));
vi.mock("#product/hooks/workspaces/derived/use-workspace-sidebar-state", () => ({ useWorkspaceSidebarState: () => workspaceSidebarState }));
vi.mock("#product/hooks/sessions/lifecycle/use-session-activity-reconciler", () => ({ useSessionActivityReconciler: () => {} }));

afterEach(() => {
  resetMainSidebarTestState();
});

describe("MainSidebar cloud workspace gating (PRO-10)", () => {
  // A cloud-configured repo's "New Cloud Workspace" action must stay gated
  // by capabilities.cloudComputeEnabled, not just billing — otherwise a
  // compute-disabled deployment still lets users spawn cloud workspaces for
  // repos already cloud-configured (cloudRepoAction.kind === "create").
  it("disables the cloud workspace action when cloudComputeEnabled is false, even though billing allows it", () => {
    cloudAvailabilityState.cloudComputeEnabled = false;

    renderMainSidebar();

    expect(screen.getByTestId("sidebar-workspace-content").dataset.cloudWorkspaceEnabled)
      .toBe("false");
  });

  it("enables the cloud workspace action when cloudComputeEnabled is true and billing allows it", () => {
    cloudAvailabilityState.cloudComputeEnabled = true;

    renderMainSidebar();

    expect(screen.getByTestId("sidebar-workspace-content").dataset.cloudWorkspaceEnabled)
      .toBe("true");
  });
});
