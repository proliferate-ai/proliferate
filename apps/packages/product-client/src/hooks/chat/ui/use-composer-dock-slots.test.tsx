/* @vitest-environment jsdom */

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerDockSlots } from "./use-composer-dock-slots";

const primaryPendingInteractionState = vi.hoisted(() => ({
  value: null as { kind: string; requestId: string } | null,
}));

const pendingPromptsState = vi.hoisted(() => ({
  value: [] as unknown[],
}));

const promptRecoveryState = vi.hoisted(() => ({
  value: [] as unknown[],
}));

const delegatedWorkState = vi.hoisted(() => ({
  value: null as Record<string, never> | null,
}));

const selectedWorkspaceState = vi.hoisted(() => ({
  value: null as string | null,
}));

vi.mock("#product/hooks/chat/derived/use-active-pending-session-interactions", () => ({
  useActivePendingInteractionState: () => ({
    primaryPendingInteraction: primaryPendingInteractionState.value,
  }),
  useActivePendingPrompts: () => pendingPromptsState.value,
}));

vi.mock("#product/hooks/chat/derived/use-chat-prompt-recoveries", () => ({
  useChatPromptRecoveries: () => ({
    recoveries: promptRecoveryState.value,
    workspaceUiKey: "workspace-1",
  }),
}));

vi.mock("#product/hooks/chat/facade/use-delegated-work-composer", () => ({
  useDelegatedWorkComposer: () => delegatedWorkState.value,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: { selectedWorkspaceId: string | null }) => unknown,
  ) => selector({ selectedWorkspaceId: selectedWorkspaceState.value }),
}));

vi.mock("#product/components/workspace/chat/input/ApprovalCard", () => ({
  ConnectedApprovalCard: () => <div data-testid="approval-card" />,
}));

vi.mock("#product/components/workspace/chat/input/McpElicitationCard", () => ({
  ConnectedMcpElicitationCard: () => <div data-testid="mcp-elicitation-card" />,
}));

vi.mock("#product/components/workspace/chat/input/PromptRecoveryPanel", () => ({
  ConnectedPromptRecoveryPanel: () => <div data-testid="prompt-recovery-panel" />,
}));
vi.mock("#product/components/workspace/chat/input/DelegatedWorkComposerPanel", () => ({
  DelegatedWorkComposerPanel: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/chat/input/delegated-work/DelegatedWorkComposerControl", () => ({
  DelegatedWorkComposerControl: () => <div data-testid="delegated-work-control" />,
}));

vi.mock("#product/components/workspace/chat/input/PendingPromptList", () => ({
  ConnectedPendingPromptList: () => <div data-testid="pending-prompt-list" />,
}));

vi.mock("#product/components/workspace/chat/input/UserInputCard", () => ({
  ConnectedUserInputCard: () => <div data-testid="user-input-card" />,
}));

afterEach(() => {
  cleanup();
  primaryPendingInteractionState.value = null;
  pendingPromptsState.value = [];
  promptRecoveryState.value = [];
  delegatedWorkState.value = null;
  selectedWorkspaceState.value = null;
});

describe("useComposerDockSlots", () => {
  it("restores queued messages in the outbound dock slot", () => {
    pendingPromptsState.value = [{ seq: 1 }];
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.outboundSlot}</>);

    expect(screen.getByTestId("pending-prompt-list")).not.toBeNull();
  });

  it("renders the interaction card as the active slot", () => {
    primaryPendingInteractionState.value = { kind: "permission", requestId: "req-1" };
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.activeSlot}</>);

    expect(screen.getByTestId("approval-card")).not.toBeNull();
  });

  it("leaves the active slot empty when there is no blocking interaction", () => {
    const { result } = renderHook(() => useComposerDockSlots());

    expect(result.current.activeSlot).toBeNull();
  });

  it("renders workspace-scoped prompt recoveries in the outbound slot", () => {
    promptRecoveryState.value = [{}];
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.outboundSlot}</>);

    expect(screen.getByTestId("prompt-recovery-panel")).not.toBeNull();
  });

  // The git/PR cap retired into the workspace-status card (trailing-cluster
  // trigger in ChatInputControlRow) — the attached stack no longer renders
  // any workspace-activity surface.
  it("keeps delegated work in the attached stack without a workspace activity cap", () => {
    delegatedWorkState.value = {};
    selectedWorkspaceState.value = "workspace-1";
    const { result } = renderHook(() => useComposerDockSlots());

    render(<>{result.current.attachedSlot}</>);

    expect(screen.getByTestId("delegated-work-control")).not.toBeNull();
    expect(screen.queryByTestId("workspace-activity-card")).toBeNull();
  });
});
