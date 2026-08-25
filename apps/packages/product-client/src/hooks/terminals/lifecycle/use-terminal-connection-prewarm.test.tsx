// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalConnectionPrewarm } from "#product/hooks/terminals/lifecycle/use-terminal-connection-prewarm";

// Q16: the gateway token refresh hoisted to workspace
// selection. resolveTerminalWorkspaceConnection is the shared warm path (it
// mints the fresh token).

const selection = vi.hoisted(() => ({ selectedWorkspaceId: null as string | null }));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (value: typeof selection) => unknown) =>
    selector(selection),
}));

// The real useWorkspaceRuntimeBlock hook memoizes getWorkspaceRuntimeBlockReason
// via useCallback keyed on [selectedCloudRuntime.state, selectedCloudRuntime.workspaceId,
// workspaceCollections?.workspaces] (see use-workspace-runtime-block.ts). Its identity
// is stable across renders where that state is unchanged, and only changes when the
// block state actually transitions. The mock below reproduces that: one accessor
// function per "phase", cached, so re-renders at the same phase reuse the same
// reference and only a phase transition produces a new one. This lets the tests
// exercise the real re-run mechanism (identity churn tied to state, not to render
// count) instead of a mock that churns on every render regardless of state.
const controller = vi.hoisted(() => {
  const reasonByPhase: Record<"clear" | "blocked", string | null> = {
    clear: null,
    blocked: "Cloud workspace is reconnecting.",
  };
  // Each cached accessor is itself a spy: because effects only invoke
  // getWorkspaceRuntimeBlockReason(selectedWorkspaceId) from inside the
  // effect body, the spy's call count is a direct proxy for "how many times
  // did the pre-warm effect actually run", independent of how many times
  // the component re-rendered or how many times resolveTerminalWorkspaceConnection
  // itself was (or wasn't) reached.
  const accessorCache = new Map<"clear" | "blocked", ReturnType<typeof vi.fn>>();
  const getAccessorForPhase = (phase: "clear" | "blocked") => {
    let accessor = accessorCache.get(phase);
    if (!accessor) {
      accessor = vi.fn(() => reasonByPhase[phase]);
      accessorCache.set(phase, accessor);
    }
    return accessor;
  };
  return {
    phase: "clear" as "clear" | "blocked",
    getAccessorForPhase,
    totalEffectAccessorCalls: () =>
      [...accessorCache.values()].reduce((sum, spy) => sum + spy.mock.calls.length, 0),
    resolveTerminalWorkspaceConnection: vi.fn(async () => ({
      runtimeUrl: "http://runtime.test",
      authToken: "fresh-token",
      anyharnessWorkspaceId: "aw-1",
      runtimeGeneration: 0,
    })),
  };
});

vi.mock("#product/hooks/terminals/workflows/use-terminal-workspace-connection", () => ({
  useTerminalWorkspaceConnection: () => ({
    getWorkspaceRuntimeBlockReason: controller.getAccessorForPhase(controller.phase),
    resolveTerminalWorkspaceConnection: controller.resolveTerminalWorkspaceConnection,
  }),
}));

describe("useTerminalConnectionPrewarm Q16 hoisted warm-up", () => {
  beforeEach(() => {
    selection.selectedWorkspaceId = null;
    controller.phase = "clear";
    controller.resolveTerminalWorkspaceConnection.mockClear();
    controller.resolveTerminalWorkspaceConnection.mockResolvedValue({
      runtimeUrl: "http://runtime.test",
      authToken: "fresh-token",
      anyharnessWorkspaceId: "aw-1",
      runtimeGeneration: 0,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("warms the connection at workspace selection", async () => {
    selection.selectedWorkspaceId = "workspace-1";
    renderHook(() => useTerminalConnectionPrewarm());

    await waitFor(() => {
      expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledWith("workspace-1");
    });
    expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(1);
  });

  it("does not pre-warm while the runtime is blocked, then warms once it clears", async () => {
    controller.phase = "blocked";
    selection.selectedWorkspaceId = "workspace-1";
    const { rerender } = renderHook(() => useTerminalConnectionPrewarm());

    expect(controller.resolveTerminalWorkspaceConnection).not.toHaveBeenCalled();

    // The phase transition swaps in a new cached accessor (new identity), which
    // is what re-runs the effect here, mirroring the real hook's useCallback
    // churning when selectedCloudRuntime.state actually changes.
    controller.phase = "clear";
    rerender();

    await waitFor(() => {
      expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(1);
    });
  });

  it("does not re-run the pre-warm effect across re-renders when the block-reason accessor identity is unchanged (regression guard)", async () => {
    selection.selectedWorkspaceId = "workspace-1";
    const { rerender } = renderHook(() => useTerminalConnectionPrewarm());

    await waitFor(() => {
      expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(1);
    });
    const callsAfterFirstRun = controller.totalEffectAccessorCalls();

    // Same phase, same workspace: the accessor cache returns the identical
    // function reference across re-renders, so the effect's dependency array
    // is referentially unchanged and the effect body must not execute again.
    // We assert on the accessor's own call count (a direct proxy for "did the
    // effect body run"), not on resolveTerminalWorkspaceConnection's call
    // count, because the ref guard inside the effect would silently absorb
    // an extra resolve call for the same workspace either way, so the accessor
    // call count is the only signal that actually exposes blanket re-runs.
    rerender();
    rerender();
    rerender();

    expect(controller.totalEffectAccessorCalls()).toBe(callsAfterFirstRun);
    expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(1);
  });

  it("degrades silently on pre-warm failure and lets a later selection retry", async () => {
    controller.resolveTerminalWorkspaceConnection.mockRejectedValueOnce(
      new Error("token refresh failed"),
    );
    selection.selectedWorkspaceId = "workspace-1";
    const { rerender } = renderHook(() => useTerminalConnectionPrewarm());

    await waitFor(() => {
      expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(1);
    });

    // Failure is swallowed (no unhandled rejection / thrown error). Re-selecting
    // the same workspace after the reset retries the warm-up via the lazy path.
    selection.selectedWorkspaceId = "workspace-2";
    rerender();
    selection.selectedWorkspaceId = "workspace-1";
    rerender();

    await waitFor(() => {
      expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(3);
    });
  });
});
