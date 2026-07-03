/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkThread } from "@anyharness/sdk";
import { CoworkThreadsSection } from "./CoworkThreadsSection";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

const coworkState = vi.hoisted(() => ({
  statusLoading: false,
  threadsLoading: false,
  threads: [] as CoworkThread[],
  createThread: vi.fn(),
  openThread: vi.fn(),
  isCreatingThread: false,
}));

vi.mock("@/components/feedback/Skeleton", () => ({
  SkeletonBlock: () => <div data-testid="threads-skeleton" />,
}));

vi.mock("@proliferate/ui/icons", () => ({
  ChevronDownUp: () => <span data-testid="collapse-icon" />,
  ChevronUpDown: () => <span data-testid="expand-icon" />,
  MessageSquarePlus: () => <span data-testid="plus-icon" />,
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

vi.mock("@/components/workspace/shell/sidebar/SidebarIndicators", () => ({
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
    trailingLabel,
  }: {
    active?: boolean;
    label: ReactNode;
    status?: ReactNode;
    trailingLabel?: string | null;
  }) => (
    <div data-testid="thread-row" data-active={String(!!active)}>
      {status}
      <span>{label}</span>
      {trailingLabel ? <span>{trailingLabel}</span> : null}
    </div>
  ),
}));

vi.mock("@/components/workspace/cowork/sidebar/CoworkThreadItem", () => ({
  CoworkThreadItem: ({ thread }: { thread: CoworkThread }) => (
    <div data-testid="real-thread-row">{thread.title ?? thread.id}</div>
  ),
}));

vi.mock("@/components/workspace/shell/sidebar/SidebarShowToggleRow", () => ({
  SidebarShowToggleRow: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

vi.mock("@/hooks/access/anyharness/cowork/use-cowork-status", () => ({
  useCoworkStatus: () => ({
    status: { enabled: true },
    isLoading: coworkState.statusLoading,
  }),
}));

vi.mock("@/hooks/access/anyharness/cowork/use-cowork-threads", () => ({
  useCoworkThreads: () => ({
    threads: coworkState.threads,
    isLoading: coworkState.threadsLoading,
  }),
}));

vi.mock("@/hooks/cowork/workflows/use-cowork-thread-workflow", () => ({
  useCoworkThreadWorkflow: () => ({
    createThread: coworkState.createThread,
    openThread: coworkState.openThread,
    isCreatingThread: coworkState.isCreatingThread,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-sidebar-activities", () => ({
  useWorkspaceSidebarActivityStates: () => ({}),
}));

const workspaceUiState = vi.hoisted(() => ({
  threadsCollapsed: false,
  setThreadsCollapsed: vi.fn(),
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
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
      displayName: "Cowork thread",
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

    expect(screen.getByText("Cowork thread")).not.toBeNull();
    expect(screen.getByText("Setting up")).not.toBeNull();
    expect(screen.getByTestId("status-iterating")).not.toBeNull();
    expect(screen.getByTestId("thread-row").getAttribute("data-active")).toBe("true");
    expect(screen.queryByText("No chats yet")).toBeNull();
    expect(screen.queryByTestId("threads-skeleton")).toBeNull();
  });

  it("does not duplicate the pending row after the real cowork thread appears", () => {
    const pendingEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-2",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Cowork thread",
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

    expect(screen.queryByText("Setting up")).toBeNull();
    expect(screen.getByTestId("real-thread-row").textContent).toBe("Real thread");
  });
});
