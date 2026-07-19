// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSessionRecoveryActions } from "#product/hooks/workspaces/workflows/use-workspace-session-recovery-actions";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

describe("useWorkspaceSessionRecoveryActions", () => {
  beforeEach(() => {
    mocks.selectWorkspace.mockReset().mockResolvedValue(undefined);
    useSessionSelectionStore.setState({
      activeSessionId: "client-session:claude:recovery",
      workspaceSessionRecovery: {
        logicalWorkspaceId: "logical:workspace-1",
        workspaceId: "workspace-1",
        sessionId: "client-session:claude:recovery",
        reason: "session-list-failed",
      },
    });
  });

  it("forces Retry to bypass the first session-directory cache read", async () => {
    const { result } = renderHook(() => useWorkspaceSessionRecoveryActions());

    await act(async () => {
      await result.current.retry();
    });

    expect(mocks.selectWorkspace).toHaveBeenCalledWith("logical:workspace-1", {
      force: true,
      forceCold: true,
      forceSessionDirectoryRefresh: true,
      initialActiveSessionId: "client-session:claude:recovery",
    });
  });

  it("restores inline recovery against the same selected shell after Retry rejects", async () => {
    mocks.selectWorkspace.mockImplementationOnce(async () => {
      useSessionSelectionStore.getState().setWorkspaceSessionRecovery(null);
      throw new Error("runtime unavailable");
    });
    const { result } = renderHook(() => useWorkspaceSessionRecoveryActions());

    await act(async () => {
      await result.current.retry();
    });

    expect(useSessionSelectionStore.getState().workspaceSessionRecovery).toEqual({
      logicalWorkspaceId: "logical:workspace-1",
      workspaceId: "workspace-1",
      sessionId: "client-session:claude:recovery",
      reason: "session-selection-failed",
    });
  });
});
