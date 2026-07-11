/* @vitest-environment jsdom */

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerDockSlots } from "./use-composer-dock-slots";

const workspaceStatusPanelState = vi.hoisted(() => ({
  value: { kind: "pending" } as unknown,
}));

const primaryPendingInteractionState = vi.hoisted(() => ({
  value: null as { kind: string; requestId: string } | null,
}));

const activeTodoTrackerState = vi.hoisted(() => ({
  value: null as { entries: unknown[] } | null,
}));

const promptRecoveryState = vi.hoisted(() => ({
  value: [] as unknown[],
}));

vi.mock("@/hooks/chat/derived/use-active-pending-session-interactions", () => ({
  useActivePendingInteractionState: () => ({
    primaryPendingInteraction: primaryPendingInteractionState.value,
  }),
  useActivePendingPrompts: () => [],
}));

vi.mock("@/hooks/chat/derived/use-active-todo-tracker", () => ({
  useActiveTodoTracker: () => activeTodoTrackerState.value,
}));

vi.mock("@/hooks/chat/derived/use-chat-prompt-recoveries", () => ({
  useChatPromptRecoveries: () => ({
    recoveries: promptRecoveryState.value,
    workspaceUiKey: "workspace-1",
  }),
}));

vi.mock("@/hooks/chat/facade/use-delegated-work-composer", () => ({
  useDelegatedWorkComposer: () => null,
}));

vi.mock("@/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
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
  TodoTrackerStrip: () => <div data-testid="todo-tracker-strip" />,
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

vi.mock("@/components/workspace/chat/input/PromptRecoveryPanel", () => ({
  ConnectedPromptRecoveryPanel: () => <div data-testid="prompt-recovery-panel" />,
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
  primaryPendingInteractionState.value = null;
  activeTodoTrackerState.value = null;
  promptRecoveryState.value = [];
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

  it("renders the todo strip below an interaction card instead of evicting plan progress", () => {
    primaryPendingInteractionState.value = { kind: "permission", requestId: "req-1" };
    activeTodoTrackerState.value = { entries: [] };
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.activeSlot}</>);

    expect(screen.getByTestId("approval-card")).not.toBeNull();
    expect(screen.getByTestId("todo-tracker-strip")).not.toBeNull();
    expect(screen.queryByTestId("todo-tracker-panel")).toBeNull();
  });

  it("renders the full tracker panel when no interaction holds the slot", () => {
    activeTodoTrackerState.value = { entries: [] };
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.activeSlot}</>);

    expect(screen.getByTestId("todo-tracker-panel")).not.toBeNull();
    expect(screen.queryByTestId("todo-tracker-strip")).toBeNull();
  });

  it("renders workspace-scoped prompt recoveries in the outbound slot", () => {
    promptRecoveryState.value = [{}];
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.outboundSlot}</>);

    expect(screen.getByTestId("prompt-recovery-panel")).not.toBeNull();
  });
});
