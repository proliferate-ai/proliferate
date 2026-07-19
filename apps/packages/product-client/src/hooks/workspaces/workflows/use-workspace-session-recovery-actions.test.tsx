// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSessionRecoveryActions } from "#product/hooks/workspaces/workflows/use-workspace-session-recovery-actions";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => ({
  goToTopLevelRoute: vi.fn(),
  selectWorkspace: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    goToTopLevelRoute: mocks.goToTopLevelRoute,
  }),
}));

describe("useWorkspaceSessionRecoveryActions", () => {
  beforeEach(() => {
    mocks.goToTopLevelRoute.mockReset();
    mocks.selectWorkspace.mockReset().mockResolvedValue(undefined);
    useSessionSelectionStore.setState({
      workspaceSessionRecovery: {
        logicalWorkspaceId: "logical:workspace-1",
        workspaceId: "workspace-1",
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
      initialActiveSessionId: null,
    });
  });
});
