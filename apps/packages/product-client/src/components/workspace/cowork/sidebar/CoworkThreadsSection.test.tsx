/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkThread } from "@anyharness/sdk";
import { CoworkThreadsSection } from "#product/components/workspace/cowork/sidebar/CoworkThreadsSection";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const coworkState = vi.hoisted(() => ({
  statusLoading: false,
  threadsLoading: false,
  threads: [] as CoworkThread[],
  createThread: vi.fn(),
  openThread: vi.fn(),
  isCreatingThread: false,
}));

vi.mock("#product/components/feedback/Skeleton", () => ({
  SkeletonBlock: () => <div data-testid="threads-skeleton" />,
}));

vi.mock("@proliferate/ui/icons", () => ({
  ChevronDownUp: () => <span data-testid="collapse-icon" />,
  ChevronUpDown: () => <span data-testid="expand-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
}));

vi.mock("@proliferate/ui/layout/SidebarActionButton", () => ({
  SidebarActionButton: ({
    children,
    disabled,
    onClick,
    title,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    title: string;
  }) => (
    <button type="button" aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("#product/components/workspace/shell/sidebar/SidebarIndicators", () => ({
  SidebarStatusIndicatorView: ({ indicator }: { indicator: { kind: string } | null }) => (
    <span data-testid={indicator ? `status-${indicator.kind}` : "status-none"} />
  ),
}));

vi.mock("@proliferate/product-ui/sidebar/ProductSidebarLayout", () => ({
  ProductSidebarSectionHeader: ({
    actions,
    label,
  }: {
    actions?: ReactNode;
    label: string;
  }) => (
    <div>
      <h2>{label}</h2>
      {actions}
    </div>
  ),
}));

vi.mock("@proliferate/product-ui/sidebar/ProductSidebarThreads", () => ({
  ProductSidebarThreadRow: ({
    active,
    label,
    status,
    trailingStatus,
    trailingLabel,
  }: {
    active?: boolean;
    label: ReactNode;
    status?: ReactNode;
    trailingStatus?: ReactNode;
    trailingLabel?: string | null;
  }) => (
    <div data-testid="thread-row" data-active={String(!!active)}>
      {status}
      <span>{label}</span>
      {trailingStatus}
      {trailingLabel ? <span>{trailingLabel}</span> : null}
    </div>
  ),
}));

vi.mock("#product/components/workspace/cowork/sidebar/CoworkThreadItem", () => ({
  CoworkThreadItem: ({ thread }: { thread: CoworkThread }) => (
    <div data-testid="real-thread-row">{thread.title ?? thread.id}</div>
  ),
}));

vi.mock("#product/components/workspace/shell/sidebar/SidebarShowToggleRow", () => ({
  SidebarShowToggleRow: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

vi.mock("#product/hooks/access/anyharness/cowork/use-cowork-status", () => ({
  useCoworkStatus: () => ({
    status: { enabled: true },
    isLoading: coworkState.statusLoading,
  }),
}));

vi.mock("#product/hooks/access/anyharness/cowork/use-cowork-threads", () => ({
  useCoworkThreads: () => ({
    threads: coworkState.threads,
    isLoading: coworkState.threadsLoading,
  }),
}));

vi.mock("#product/hooks/cowork/workflows/use-cowork-thread-workflow", () => ({
  useCoworkThreadWorkflow: () => ({
    createThread: coworkState.createThread,
    openThread: coworkState.openThread,
    isCreatingThread: coworkState.isCreatingThread,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-sidebar-activities", () => ({
  useWorkspaceSidebarActivityStates: () => ({}),
}));

const workspaceUiState = vi.hoisted(() => ({
  threadsCollapsed: false,
  setThreadsCollapsed: vi.fn(),
}));

vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (selector: (state: typeof workspaceUiState) => unknown) =>
    selector(workspaceUiState),
}));

describe("CoworkThreadsSection", () => {
  beforeEach(() => {
    coworkState.statusLoading = false;
    coworkState.threadsLoading = false;
    coworkState.threads = [];
    coworkState.isCreatingThread = false;
    coworkState.createThread.mockClear();
    coworkState.openThread.mockClear();
    workspaceUiState.threadsCollapsed = false;
    workspaceUiState.setThreadsCollapsed.mockClear();
    useSessionSelectionStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a pending cowork thread while the real thread list loads", () => {
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Untitled chat",
      request: {
        kind: "cowork",
        input: {
          agentKind: "claude",
          modelId: "sonnet",
          sourceWorkspaceId: null,
        },
      },
    });
    coworkState.threadsLoading = true;
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: pendingEntry,
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pendingEntry),
    });

    render(<CoworkThreadsSection />);

    expect(screen.getByText("Untitled chat")).not.toBeNull();
    // The trailing spinner alone marks the pending row (trailingStatus wins
    // over any trailing label, so the row no longer carries "Setting up").
    expect(screen.getByTestId("status-iterating")).not.toBeNull();
    expect(screen.getByTestId("thread-row").getAttribute("data-active")).toBe("true");
    expect(screen.queryByText("No chats yet")).toBeNull();
    expect(screen.queryByTestId("threads-skeleton")).toBeNull();
  });

  it("keeps the pending projection and suppresses its real row until handoff completes", () => {
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-2",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Untitled chat",
      request: {
        kind: "cowork",
        input: {
          agentKind: "claude",
          modelId: "sonnet",
          sourceWorkspaceId: null,
        },
      },
    });
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: {
        ...pendingEntry,
        workspaceId: "workspace-cowork",
      },
    });
    coworkState.threads = [{
      id: "thread-1",
      agentKind: "claude",
      branchName: "main",
      createdAt: "2026-01-01T00:00:00Z",
      lastActivityAt: null,
      repoRootId: "repo-root-1",
      requestedModelId: "sonnet",
      sessionId: "session-1",
      title: "Real thread",
      updatedAt: "2026-01-01T00:00:00Z",
      workspaceDelegationEnabled: false,
      workspaceId: "workspace-cowork",
    }];

    render(<CoworkThreadsSection />);

    expect(screen.getByText("Untitled chat")).not.toBeNull();
    expect(screen.getByTestId("status-iterating")).not.toBeNull();
    expect(screen.queryByTestId("real-thread-row")).toBeNull();
  });

  it("shows the real thread after the pending handoff clears", () => {
    coworkState.threads = [{
      id: "thread-1",
      agentKind: "claude",
      branchName: "main",
      createdAt: "2026-01-01T00:00:00Z",
      lastActivityAt: null,
      repoRootId: "repo-root-1",
      requestedModelId: "sonnet",
      sessionId: "session-1",
      title: "Real thread",
      updatedAt: "2026-01-01T00:00:00Z",
      workspaceDelegationEnabled: false,
      workspaceId: "workspace-cowork",
    }];

    render(<CoworkThreadsSection />);

    expect(screen.queryByTestId("thread-row")).toBeNull();
    expect(screen.getByTestId("real-thread-row").textContent).toBe("Real thread");
  });

  it("keeps the selected error projection when a materialized pending entry fails", () => {
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-failed",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Untitled chat",
      request: {
        kind: "cowork",
        input: {
          agentKind: "claude",
          modelId: "sonnet",
          sourceWorkspaceId: null,
        },
      },
    });
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: {
        ...pendingEntry,
        stage: "failed",
        workspaceId: "workspace-cowork",
        errorMessage: "Couldn't apply launch defaults",
      },
    });
    coworkState.threads = [{
      id: "thread-1",
      agentKind: "claude",
      branchName: "main",
      createdAt: "2026-01-01T00:00:00Z",
      lastActivityAt: null,
      repoRootId: "repo-root-1",
      requestedModelId: "sonnet",
      sessionId: "session-1",
      title: "Real thread",
      updatedAt: "2026-01-01T00:00:00Z",
      workspaceDelegationEnabled: false,
      workspaceId: "workspace-cowork",
    }];

    render(<CoworkThreadsSection />);

    expect(screen.getByTestId("thread-row")).not.toBeNull();
    expect(screen.getByTestId("status-error")).not.toBeNull();
    expect(screen.queryByTestId("real-thread-row")).toBeNull();
  });

  it("shows an error status when creation fails before materialization", () => {
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-failed-before-create",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Untitled chat",
      request: {
        kind: "cowork",
        input: {
          agentKind: "claude",
          modelId: "sonnet",
          sourceWorkspaceId: null,
        },
      },
    });
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: {
        ...pendingEntry,
        stage: "failed",
        errorMessage: "Couldn't create chat",
      },
    });

    render(<CoworkThreadsSection />);

    expect(screen.getByTestId("status-error")).not.toBeNull();
    expect(screen.queryByTestId("status-iterating")).toBeNull();
  });

  it("keeps a failed materialized row visible until the real query row arrives", () => {
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-failed-awaiting-query",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Untitled chat",
      request: {
        kind: "cowork",
        input: {
          agentKind: "claude",
          modelId: "sonnet",
          sourceWorkspaceId: null,
        },
      },
    });
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: {
        ...pendingEntry,
        stage: "failed",
        workspaceId: "workspace-cowork",
        errorMessage: "Couldn't apply launch defaults",
      },
    });

    render(<CoworkThreadsSection />);

    expect(screen.getByTestId("thread-row")).not.toBeNull();
    expect(screen.getByTestId("status-error")).not.toBeNull();
    expect(screen.queryByText("No chats yet")).toBeNull();
  });
});
