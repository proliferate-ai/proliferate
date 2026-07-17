// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkflowRunOpenActions } from "./use-workflow-run-open-actions";

const deps = vi.hoisted(() => ({
  refresh: vi.fn(),
  open: vi.fn(),
}));

vi.mock("#product/hooks/cloud/workflows/use-cloud-workspace-actions", () => ({
  useCloudWorkspaceActions: () => ({ refreshCloudWorkspace: deps.refresh }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-activation-workflow", () => ({
  useWorkspaceActivationWorkflow: () => ({ openWorkspaceSession: deps.open }),
}));

const target = {
  cloudWorkspaceId: "cloud-1",
  anyharnessWorkspaceId: "runtime-1",
  sessionId: "session-1",
};

describe("useWorkflowRunOpenActions", () => {
  afterEach(() => vi.clearAllMocks());

  it.each(["repositoryWorktree", "scratch"])(
    "refreshes and opens the exact %s Cloud workspace/session correlation",
    async (workspaceKind) => {
      deps.refresh.mockResolvedValue({
        id: "cloud-1",
        workspaceKind,
        productLifecycle: "active",
        workspaceStatus: "ready",
        anyharnessWorkspaceId: "runtime-1",
      });
      deps.open.mockResolvedValue({ result: "completed" });
      const { result } = renderHook(() => useWorkflowRunOpenActions());

      let outcome;
      await act(async () => {
        outcome = await result.current.openWorkflowRunSession(target);
      });

      expect(outcome).toEqual({ opened: true });
      expect(deps.refresh).toHaveBeenCalledWith("cloud-1");
      expect(deps.open).toHaveBeenCalledWith({
        workspaceId: "cloud:cloud-1",
        sessionId: "session-1",
      });
    },
  );

  it.each([
    ["wrong row", { id: "cloud-2", productLifecycle: "active", workspaceStatus: "ready", anyharnessWorkspaceId: "runtime-1" }],
    ["archived", { id: "cloud-1", productLifecycle: "archived", workspaceStatus: "archived", anyharnessWorkspaceId: "runtime-1" }],
    ["replaced runtime", { id: "cloud-1", productLifecycle: "active", workspaceStatus: "ready", anyharnessWorkspaceId: "runtime-2" }],
  ])("refuses %s without minting or opening a replacement", async (_name, workspace) => {
    deps.refresh.mockResolvedValue(workspace);
    const { result } = renderHook(() => useWorkflowRunOpenActions());

    let outcome;
    await act(async () => {
      outcome = await result.current.openWorkflowRunSession(target);
    });

    expect(outcome).toEqual({
      opened: false,
      message: "This workflow session is no longer available.",
    });
    expect(deps.open).not.toHaveBeenCalled();
  });
});
