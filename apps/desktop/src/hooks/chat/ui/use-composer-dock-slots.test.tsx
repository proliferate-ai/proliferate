/* @vitest-environment jsdom */

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerDockSlots } from "./use-composer-dock-slots";

const workspaceStatusPanelState = vi.hoisted(() => ({
  value: { kind: "pending" } as unknown,
}));

vi.mock("@/hooks/chat/derived/use-active-chat-session-selectors", () => ({
  useActivePendingInteractionState: () => ({ primaryPendingInteraction: null }),
  useActivePendingPrompts: () => [],
}));

vi.mock("@/hooks/chat/derived/use-active-todo-tracker", () => ({
  useActiveTodoTracker: () => null,
}));

vi.mock("@/hooks/chat/facade/use-delegated-work-composer", () => ({
  useDelegatedWorkComposer: () => null,
}));

vi.mock("@/hooks/workspaces/cache/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => ({ state: null }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-status-panel-state", () => ({
  useWorkspaceStatusPanelState: () => workspaceStatusPanelState.value,
}));

vi.mock("@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel", () => ({
  WorkspaceArrivalAttachedPanel: () => <div data-testid="workspace-status-panel" />,
}));

vi.mock("@/components/workspace/chat/surface/CloudRuntimeAttachedPanel", () => ({
  CloudRuntimeAttachedPanel: () => <div data-testid="cloud-runtime-panel" />,
}));

vi.mock("@/components/workspace/chat/input/TodoTrackerPanel", () => ({
  TodoTrackerPanel: () => <div data-testid="todo-tracker-panel" />,
}));

vi.mock("@/components/workspace/chat/input/ApprovalCard", () => ({
  ConnectedApprovalCard: () => <div data-testid="approval-card" />,
}));

vi.mock("@/components/workspace/chat/input/McpElicitationCard", () => ({
  ConnectedMcpElicitationCard: () => <div data-testid="mcp-elicitation-card" />,
}));

vi.mock("@/components/workspace/chat/input/PendingPromptList", () => ({
  ConnectedPendingPromptList: () => <div data-testid="pending-prompt-list" />,
}));

vi.mock("@/components/workspace/chat/input/DelegatedWorkComposerPanel", () => ({
  DelegatedWorkComposerPanel: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl", () => ({
  DelegatedWorkComposerControl: () => <div data-testid="delegated-work-control" />,
}));

vi.mock("@/components/workspace/chat/input/UserInputCard", () => ({
  ConnectedUserInputCard: () => <div data-testid="user-input-card" />,
}));

afterEach(() => {
  cleanup();
  workspaceStatusPanelState.value = { kind: "pending" };
});

describe("useComposerDockSlots", () => {
  it("renders workspace status panels by default", () => {
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.attachedSlot}</>);

    expect(screen.getByTestId("workspace-status-panel")).not.toBeNull();
  });

  it("suppresses workspace status panels when requested", () => {
    const { result } = renderHook(() => useComposerDockSlots({
      suppressWorkspaceStatusPanels: true,
    }));

    render(<>{result.current.attachedSlot}</>);

    expect(screen.queryByTestId("workspace-status-panel")).toBeNull();
  });
});
