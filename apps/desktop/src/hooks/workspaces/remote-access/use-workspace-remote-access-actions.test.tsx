// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRemoteAccessActions } from "@/hooks/workspaces/remote-access/use-workspace-remote-access-actions";

const hookMocks = vi.hoisted(() => ({
  bootstrapMutateAsync: vi.fn(() => Promise.resolve({})),
  createExistingTargetEnrollment: vi.fn(),
  createTargetEnrollment: vi.fn(),
  disableMutateAsync: vi.fn(() => Promise.resolve({})),
  enableMutateAsync: vi.fn(() => Promise.resolve({})),
  ensureDesktopDispatchWorker: vi.fn(() => Promise.resolve()),
  getRuntimeInfo: vi.fn(() => Promise.resolve({ status: "healthy" })),
  getTarget: vi.fn(() => Promise.resolve({
    id: "target-1",
    kind: "desktop_dispatch",
    ownerScope: "personal",
    status: "online",
    statusDetail: { updatedAt: new Date(Date.now() + 1_000).toISOString() },
    update: null,
  })),
  refetchTargets: vi.fn(),
  showToast: vi.fn(),
  mobility: {
    selectionLocked: false,
    selectedLogicalWorkspace: {
      cloudWorkspace: {
        id: "cloud-workspace-1",
        exposureState: "paused",
        sandboxType: "cloud",
        targetId: null,
      },
      displayName: "Workspace",
      localWorkspace: null,
    },
  },
}));

vi.mock("@/hooks/access/cloud/use-cloud-workspace-remote-access-mutation", () => ({
  useBootstrapCloudWorkspaceRemoteAccess: () => ({
    isPending: false,
    mutateAsync: hookMocks.bootstrapMutateAsync,
  }),
  useDisableCloudWorkspaceRemoteAccess: () => ({
    isPending: false,
    mutateAsync: hookMocks.disableMutateAsync,
  }),
  useEnableCloudWorkspaceRemoteAccess: () => ({
    isPending: false,
    mutateAsync: hookMocks.enableMutateAsync,
  }),
}));

vi.mock("@/hooks/access/cloud/targets/use-cloud-target-mutations", () => ({
  useCloudTargetMutations: () => ({
    createExistingTargetEnrollment: hookMocks.createExistingTargetEnrollment,
    createTargetEnrollment: hookMocks.createTargetEnrollment,
    isCreatingExistingTargetEnrollment: false,
    isCreatingTargetEnrollment: false,
  }),
}));

vi.mock("@/hooks/access/cloud/targets/use-cloud-targets", () => ({
  useCloudTargets: () => ({
    data: [],
    isLoading: false,
    refetch: hookMocks.refetchTargets,
  }),
}));

vi.mock("@/hooks/workspaces/mobility/use-workspace-mobility-state", () => ({
  useWorkspaceMobilityState: () => hookMocks.mobility,
}));

vi.mock("@/lib/access/tauri/cloud-worker", () => ({
  ensureDesktopDispatchWorker: hookMocks.ensureDesktopDispatchWorker,
}));

vi.mock("@/lib/access/tauri/runtime", () => ({
  getRuntimeInfo: hookMocks.getRuntimeInfo,
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string, type?: "error" | "info") => void }) => unknown) =>
    selector({ show: hookMocks.showToast }),
}));

vi.mock("@proliferate/cloud-sdk", () => ({
  getTarget: hookMocks.getTarget,
}));

describe("useWorkspaceRemoteAccessActions", () => {
  beforeEach(() => {
    hookMocks.bootstrapMutateAsync.mockClear();
    hookMocks.createExistingTargetEnrollment.mockClear();
    hookMocks.createTargetEnrollment.mockClear();
    hookMocks.disableMutateAsync.mockClear();
    hookMocks.enableMutateAsync.mockClear();
    hookMocks.ensureDesktopDispatchWorker.mockClear();
    hookMocks.getRuntimeInfo.mockClear();
    hookMocks.getTarget.mockClear();
    hookMocks.refetchTargets.mockClear();
    hookMocks.showToast.mockClear();
    hookMocks.mobility.selectionLocked = false;
    hookMocks.mobility.selectedLogicalWorkspace.cloudWorkspace.exposureState = "paused";
  });

  afterEach(() => {
    cleanup();
  });

  it("syncs a paused cloud exposure back to web", async () => {
    const { result } = renderHook(() => useWorkspaceRemoteAccessActions());

    act(() => {
      result.current.syncToWeb();
    });

    await waitFor(() => {
      expect(hookMocks.enableMutateAsync).toHaveBeenCalledWith("cloud-workspace-1");
      expect(hookMocks.showToast).toHaveBeenCalledWith("Remote access enabled.");
    });
    expect(hookMocks.disableMutateAsync).not.toHaveBeenCalled();
  });

  it("does not re-enable an already live cloud exposure", async () => {
    hookMocks.mobility.selectedLogicalWorkspace.cloudWorkspace.exposureState = "live";
    const { result } = renderHook(() => useWorkspaceRemoteAccessActions());

    act(() => {
      result.current.syncToWeb();
    });

    await waitFor(() => {
      expect(hookMocks.showToast).toHaveBeenCalledWith(
        "Workspace is already available from web.",
        "info",
      );
    });
    expect(hookMocks.enableMutateAsync).not.toHaveBeenCalled();
    expect(hookMocks.disableMutateAsync).not.toHaveBeenCalled();
  });
});
