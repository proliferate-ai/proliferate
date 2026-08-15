/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSupportModalStore } from "#product/stores/support/support-modal-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { runShortcutHandler } from "#product/lib/domain/shortcuts/registry";
import {
  cloudAvailabilityState,
  LOGICAL_ID,
  makePinnedItemState,
  productHostState,
  releaseNoticeState,
  renderMainSidebar,
  resetMainSidebarTestState,
  RUNTIME_ID,
  sidebarActionMocks,
  toastShowMock,
  workflowsGateState,
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

vi.mock("#product/lib/domain/capabilities/workflows-v2", () => ({ isWorkflowsV2Enabled: () => workflowsGateState.enabled }));
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
vi.mock("#product/hooks/workspaces/derived/use-sidebar-shortcut-targets", () => ({ useSidebarShortcutTargets: () => [] }));
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

describe("MainSidebar host capabilities", () => {
  it("omits Desktop-only Cowork threads on Web", () => {
    renderMainSidebar();

    expect(screen.queryByTestId("cowork-threads")).toBeNull();
  });

  it("shows Cowork threads when the Desktop bridge is available", () => {
    productHostState.desktop = {};

    renderMainSidebar();

    expect(screen.getByTestId("cowork-threads")).not.toBeNull();
  });
});

describe("MainSidebar scroll boundary", () => {
  function navRow(name: string): HTMLElement {
    const row = screen
      .getAllByRole("button", { name: new RegExp(`^${name}`) })
      .find((element) => element.getAttribute("role") === "button");
    if (!row) {
      throw new Error(`Expected a ${name} nav row`);
    }
    return row;
  }

  it("pins New chat above the scroll region", () => {
    renderMainSidebar();

    const scrollArea = screen.getByTestId("sidebar-scroll-area");
    expect(scrollArea.contains(navRow("New chat"))).toBe(false);
  });

  it("scrolls Workspaces, Workflows and Support with the repository list", () => {
    renderMainSidebar();

    const scrollArea = screen.getByTestId("sidebar-scroll-area");
    for (const label of ["Workspaces", "Workflows", "Support"]) {
      expect(scrollArea.contains(navRow(label))).toBe(true);
    }
    // ...and above the repositories they now scroll with.
    const repositories = screen.getByText("Repositories");
    expect(scrollArea.contains(repositories)).toBe(true);
    expect(
      navRow("Support").compareDocumentPosition(repositories)
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("MainSidebar workflows gate", () => {
  function workflowsRows(): HTMLElement[] {
    return screen.queryAllByRole("button", { name: /^Workflows/ });
  }

  it("renders the Workflows row while the gate is on", () => {
    workflowsGateState.enabled = true;

    renderMainSidebar();

    expect(workflowsRows()).toHaveLength(1);
  });

  it("omits the Workflows row entirely while the gate is off", () => {
    workflowsGateState.enabled = false;

    renderMainSidebar();

    expect(workflowsRows()).toHaveLength(0);
    // The neighbouring destinations are untouched: only the gen-2 row goes.
    expect(screen.queryAllByRole("button", { name: /^Workspaces/ })).not.toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /^Support/ })).not.toHaveLength(0);
  });
});

describe("MainSidebar support modal", () => {
  it("opens the feedback modal from Support", async () => {
    renderMainSidebar();

    fireEvent.click(screen.getByRole("button", { name: /Support/ }));

    await waitFor(() => {
      expect(useSupportModalStore.getState().open).toBe(true);
      expect(useSupportModalStore.getState().kind).toBe("bug");
    });
  });
});

describe("MainSidebar new chat entry points", () => {
  it("no longer starts a new chat from the Repositories header", () => {
    renderMainSidebar();

    // The header's "+" adds a repository now; the nav above owns New chat,
    // and that nav row is the only "New chat" left (it is not a <button>).
    expect(
      screen
        .getAllByRole("button", { name: "New chat" })
        .filter((element) => element.tagName === "BUTTON"),
    ).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Add repository" }).length)
      .toBeGreaterThan(0);
  });

  it("starts a repository-scoped new chat from a repo action", () => {
    renderMainSidebar();

    fireEvent.click(screen.getByRole("button", { name: "New chat in Repo A" }));
    expect(sidebarActionMocks.handleGoHomeForRepository).toHaveBeenCalledWith("/repo-a");
  });
});

describe("MainSidebar release notice", () => {
  it("omits the card when the facade has no notice", () => {
    renderMainSidebar();

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("keeps the card out of the tab order when the sidebar is collapsed", () => {
    releaseNoticeState.notice = {
      version: "0.3.25",
      title: "Introducing Grok",
    };
    workspaceUiState.sidebarOpen = false;

    renderMainSidebar();

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("button", {
      name: "Dismiss release notice for 0.3.25",
    })).toBeNull();
  });

  it("renders the release card immediately above the account footer", () => {
    releaseNoticeState.notice = {
      version: "0.3.25",
      title: "Introducing Grok",
    };

    renderMainSidebar();

    const card = screen.getByRole("complementary", {
      name: "What's new in 0.3.25: Introducing Grok",
    });
    const footer = screen.getByTestId("sidebar-account-footer");
    expect(card.nextElementSibling).toBe(footer);
  });

  it("wires release notice actions through the facade", () => {
    releaseNoticeState.notice = {
      version: "0.3.25",
      title: "Introducing Grok",
    };

    renderMainSidebar();
    fireEvent.click(screen.getByRole("button", {
      name: "Dismiss release notice for 0.3.25",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Open changelog for 0.3.25",
    }));

    expect(releaseNoticeState.dismissNotice).toHaveBeenCalledTimes(1);
    expect(releaseNoticeState.openChangelog).toHaveBeenCalledTimes(1);
  });
});

describe("MainSidebar pinned section", () => {
  it("hides the Pinned section while nothing is pinned", () => {
    renderMainSidebar();

    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("renders pinned workspaces above the Repositories section", () => {
    workspaceSidebarState.pinnedItems = [makePinnedItemState()];

    renderMainSidebar();

    const header = screen.getByText("Pinned");
    const repositoriesHeader = screen.getByText("Repositories");
    expect(screen.getByText("Pinned workspace")).not.toBeNull();
    expect(
      header.compareDocumentPosition(repositoriesHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("selects a workspace from the pinned section", () => {
    workspaceSidebarState.pinnedItems = [makePinnedItemState()];

    renderMainSidebar();
    fireEvent.click(screen.getByText("Pinned workspace"));

    expect(sidebarActionMocks.handleSelectWorkspace).toHaveBeenCalledWith("ws-pinned");
  });
});

describe("MainSidebar archive workspace (§3.2/§5.6/§9)", () => {
  // A real group, so the resolver's actual lookup is exercised rather than
  // its not-found fallback.
  beforeEach(() => {
    useToastStore.setState({ show: toastShowMock });
    workspaceSidebarState.groups = [{
      sourceRoot: "/repo-a",
      items: [{ active: false, id: LOGICAL_ID, localWorkspaceId: RUNTIME_ID, cloudWorkspaceId: null, name: "Feature workspace" }],
    }];
  });

  it("declines the ⌘⇧A shortcut when nothing is selected", () => {
    renderMainSidebar();
    const consumed = runShortcutHandler("workspace.archive", { source: "keyboard" });

    expect(consumed).toBe(false);
    expect(workspaceArchiveActionsMock.archive).not.toHaveBeenCalled();
    expect(sidebarActionMocks.handleGoHome).not.toHaveBeenCalled();
  });

  it("archives the runtime workspace id, never the logical sidebar id, and leaves an unrelated selection alone", () => {
    workspaceSidebarState.selectedWorkspaceId = "some-other-workspace";

    renderMainSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Archive Feature workspace" }));

    expect(workspaceArchiveActionsMock.archive.mock.calls[0][0]).toBe(RUNTIME_ID);
    expect(workspaceArchiveActionsMock.archive)
      .toHaveBeenCalledWith(RUNTIME_ID, "Feature workspace", false);
    expect(sidebarActionMocks.handleGoHome).not.toHaveBeenCalled();
  });

  it("archives the selected workspace via ⌘⇧A and hands off selection first", () => {
    workspaceSidebarState.selectedLogicalWorkspaceId = LOGICAL_ID;
    workspaceSidebarState.selectedWorkspaceId = RUNTIME_ID;

    renderMainSidebar();
    const consumed = runShortcutHandler("workspace.archive", { source: "keyboard" });

    expect(consumed).toBe(true);
    expect(sidebarActionMocks.handleGoHome).toHaveBeenCalledTimes(1);
    expect(workspaceArchiveActionsMock.archive)
      .toHaveBeenCalledWith(RUNTIME_ID, "Feature workspace", true);

    const goHomeOrder = sidebarActionMocks.handleGoHome.mock.invocationCallOrder[0];
    const archiveOrder = workspaceArchiveActionsMock.archive.mock.invocationCallOrder[0];
    expect(goHomeOrder).toBeLessThan(archiveOrder);
  });

  // ⌘⇧A falls back to `selectedWorkspaceId` — a RUNTIME id — so the resolver
  // has to recognize that id space too.
  it("resolves the ⌘⇧A target from a runtime-id selection", () => {
    workspaceSidebarState.selectedWorkspaceId = RUNTIME_ID;

    renderMainSidebar();
    const consumed = runShortcutHandler("workspace.archive", { source: "keyboard" });

    expect(consumed).toBe(true);
    expect(workspaceArchiveActionsMock.archive)
      .toHaveBeenCalledWith(RUNTIME_ID, "Feature workspace", true);
    expect(sidebarActionMocks.handleGoHome).toHaveBeenCalledTimes(1);
  });

  // The other selection space: a logical selection counts as selected too.
  it("hands selection off before archiving a row selected in logical space", () => {
    workspaceSidebarState.selectedLogicalWorkspaceId = LOGICAL_ID;

    renderMainSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Archive Feature workspace" }));

    expect(sidebarActionMocks.handleGoHome).toHaveBeenCalledTimes(1);
    expect(workspaceArchiveActionsMock.archive)
      .toHaveBeenCalledWith(RUNTIME_ID, "Feature workspace", true);

    const goHomeOrder = sidebarActionMocks.handleGoHome.mock.invocationCallOrder[0];
    const archiveOrder = workspaceArchiveActionsMock.archive.mock.invocationCallOrder[0];
    expect(goHomeOrder).toBeLessThan(archiveOrder);
  });

  // The optimistic-hide set is keyed by the id handed to `archive()` — the
  // runtime id — while rows are keyed logically, so the filter spans both.
  it("hides a row whose runtime id is optimistically archived", () => {
    workspaceArchiveActionsMock.optimisticallyArchivedIds = new Set([RUNTIME_ID]);

    renderMainSidebar();
    expect(screen.queryByTestId(`sidebar-row-${LOGICAL_ID}`)).toBeNull();
  });

  it("refuses to archive a row with no runtime workspace yet", () => {
    workspaceSidebarState.groups = [{
      sourceRoot: "/repo-a",
      items: [{ active: false, id: "pending:repo-a", localWorkspaceId: null, cloudWorkspaceId: null, name: "Pending workspace" }],
    }];

    renderMainSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Archive Pending workspace" }));

    expect(workspaceArchiveActionsMock.archive).not.toHaveBeenCalled();
    expect(toastShowMock).toHaveBeenCalledWith('Couldn\'t archive "Pending workspace"');
    expect(sidebarActionMocks.handleGoHome).not.toHaveBeenCalled();
  });

  it("unarchives a workspace from its row action by its runtime id", () => {
    renderMainSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Unarchive Feature workspace" }));

    expect(workspaceArchiveActionsMock.unarchive)
      .toHaveBeenCalledWith(RUNTIME_ID, "Feature workspace");
  });
});
