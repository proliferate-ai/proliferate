// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerBlockedState } from "./use-composer-blocked-state";

const mocks = vi.hoisted(() => ({
  panelState: null as unknown,
  runtimeState: { state: null as unknown, retry: null, claim: null, claimPending: false },
  worktreeMissingActions: {
    checkAgain: vi.fn(async () => undefined),
    isCheckingAgain: false,
    restoreWorktree: vi.fn(async () => true),
    isRestoring: false,
    restoreError: null as string | null,
  },
  pendingEntryActions: { handleBack: vi.fn(), handleRetry: vi.fn() },
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-status-panel-state", () => ({
  useWorkspaceStatusPanelState: () => mocks.panelState,
}));
vi.mock("#product/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => mocks.runtimeState,
}));
vi.mock("#product/hooks/workspaces/workflows/use-worktree-missing-actions", () => ({
  useWorktreeMissingActions: () => mocks.worktreeMissingActions,
}));
vi.mock("#product/hooks/workspaces/workflows/use-pending-workspace-entry-actions", () => ({
  usePendingWorkspaceEntryActions: () => mocks.pendingEntryActions,
}));

function cloudStatusPanel(mode: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "cloud-status",
    workspaceId: "cloud-1",
    model: {
      mode,
      title: "Workspace lost",
      description: "The sandbox was killed.",
      footer: { kind: "action", action: "delete", label: "Delete" },
      ...overrides,
    },
  };
}

beforeEach(() => {
  mocks.panelState = null;
  mocks.runtimeState = { state: null, retry: null, claim: null, claimPending: false };
  mocks.worktreeMissingActions.restoreError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useComposerBlockedState", () => {
  it("returns null when nothing blocks", () => {
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current).toBeNull();
  });

  it("returns null when suppressed even while a panel state is active", () => {
    mocks.panelState = {
      kind: "directory-missing",
      workspaceId: "ws-1",
      workspaceKind: "worktree",
      restoreEligible: true,
    };
    const { result } = renderHook(() => useComposerBlockedState({ suppress: true }));
    expect(result.current).toBeNull();
  });

  it("does NOT take over for in-flight provisioning — the composer stays usable for queueing", () => {
    mocks.panelState = {
      kind: "pending",
      isFailed: false,
      subtitle: "Creating cloud workspace…",
      entry: { id: "entry-1" },
    };
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current).toBeNull();
  });

  it("takes over for failed provisioning with back/retry", () => {
    mocks.panelState = {
      kind: "pending",
      isFailed: true,
      subtitle: "Workspace setup failed.",
      entry: { id: "entry-1" },
    };
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current?.actions.map((action) => action.label)).toEqual(["Back", "Retry"]);
    expect(result.current?.icon).toBe("alert");
  });

  it("maps a missing directory with restore gated on eligibility", () => {
    mocks.panelState = {
      kind: "directory-missing",
      workspaceId: "ws-1",
      workspaceKind: "worktree",
      restoreEligible: false,
    };
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current?.actions.map((action) => action.label)).toEqual(["Check again"]);
  });

  it("surfaces the last restore error as the message", () => {
    mocks.panelState = {
      kind: "directory-missing",
      workspaceId: "ws-1",
      workspaceKind: "worktree",
      restoreEligible: true,
    };
    mocks.worktreeMissingActions.restoreError = "Restore failed: path occupied";
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current?.message).toBe("Restore failed: path occupied");
  });

  it("renders the lost-workspace status without an action (the status-screen actions died with the cloud stack)", () => {
    mocks.panelState = cloudStatusPanel("lost");
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current).not.toBeNull();
    expect(result.current?.actions).toEqual([]);
  });

  it("frames cloud-attention messages with the model title", () => {
    mocks.panelState = cloudStatusPanel("error", {
      title: "Provisioning failed",
      description: "exit code 1",
      footer: { kind: "action", action: "retry", label: "Retry provisioning" },
    });
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current?.message).toBe("Provisioning failed. exit code 1");
    expect(result.current?.actions).toEqual([]);
  });

  it("maps a failed runtime to a retry takeover when no panel state is active", () => {
    mocks.runtimeState = {
      state: {
        phase: "failed",
        title: "Reconnect failed",
        subtitle: "Couldn't reach the sandbox.",
        actionBlockReason: null,
        showRetry: true,
        showClaim: false,
      },
      retry: vi.fn(),
      claim: null,
      claimPending: false,
    };
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current?.actions.map((action) => action.label)).toEqual(["Retry"]);
  });

  it("prefers panel-derived state over the runtime bucket", () => {
    mocks.panelState = {
      kind: "directory-missing",
      workspaceId: "ws-1",
      workspaceKind: "worktree",
      restoreEligible: true,
    };
    mocks.runtimeState = {
      state: {
        phase: "failed",
        title: "Reconnect failed",
        subtitle: "Couldn't reach the sandbox.",
        actionBlockReason: null,
        showRetry: true,
        showClaim: false,
      },
      retry: vi.fn(),
      claim: null,
      claimPending: false,
    };
    const { result } = renderHook(() => useComposerBlockedState());
    expect(result.current?.actions.map((action) => action.label)).toEqual([
      "Check again",
      "Restore worktree",
    ]);
  });
});
