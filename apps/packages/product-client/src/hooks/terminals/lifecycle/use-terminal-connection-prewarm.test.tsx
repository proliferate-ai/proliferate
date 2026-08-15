// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalConnectionPrewarm } from "#product/hooks/terminals/lifecycle/use-terminal-connection-prewarm";

// Q16: the gateway token refresh + SSH tunnel warm-up hoisted to workspace
// selection. resolveTerminalWorkspaceConnection is the shared warm path (it
// mints the fresh token and, on desktop, opens the SSH tunnel).

const selection = vi.hoisted(() => ({ selectedWorkspaceId: null as string | null }));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (value: typeof selection) => unknown) =>
    selector(selection),
}));

const controller = vi.hoisted(() => ({
  blockReason: null as string | null,
  resolveTerminalWorkspaceConnection: vi.fn(async () => ({
    runtimeUrl: "http://runtime.test",
    authToken: "fresh-token",
    anyharnessWorkspaceId: "aw-1",
    runtimeGeneration: 0,
  })),
  // Identity changes when block state resolves (mirrors the real useCallback
  // whose deps include the cloud-runtime state), which re-runs the effect.
  getWorkspaceRuntimeBlockReason: vi.fn(() => controller.blockReason),
}));

vi.mock("#product/hooks/terminals/workflows/use-terminal-workspace-connection", () => ({
  useTerminalWorkspaceConnection: () => ({
    getWorkspaceRuntimeBlockReason: (workspaceId: string | null | undefined) =>
      controller.getWorkspaceRuntimeBlockReason(workspaceId),
    resolveTerminalWorkspaceConnection: controller.resolveTerminalWorkspaceConnection,
  }),
}));

describe("useTerminalConnectionPrewarm Q16 hoisted warm-up", () => {
  beforeEach(() => {
    selection.selectedWorkspaceId = null;
    controller.blockReason = null;
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

  it("warms the connection at workspace selection, before any pane attach", async () => {
    selection.selectedWorkspaceId = "workspace-1";
    renderHook(() => useTerminalConnectionPrewarm());

    await waitFor(() => {
      expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledWith("workspace-1");
    });
    expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(1);
  });

  it("does not pre-warm while the runtime is blocked, then warms once it clears", async () => {
    controller.blockReason = "Cloud workspace is reconnecting.";
    selection.selectedWorkspaceId = "workspace-1";
    const { rerender } = renderHook(() => useTerminalConnectionPrewarm());

    expect(controller.resolveTerminalWorkspaceConnection).not.toHaveBeenCalled();

    controller.blockReason = null;
    rerender();

    await waitFor(() => {
      expect(controller.resolveTerminalWorkspaceConnection).toHaveBeenCalledTimes(1);
    });
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
