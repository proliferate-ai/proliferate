// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceAvailabilityActions } from "#product/hooks/workspaces/workflows/use-workspace-availability-actions";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  selectWorkspace: vi.fn(),
  createCloudWorkspace: vi.fn(),
  getStatus: vi.fn(),
  cloudComputeEnabled: true,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({ runtimeUrl: "http://localhost:1234" }),
  resolveRuntimeConnection: (runtime: unknown) => runtime,
  getAnyHarnessClient: () => ({
    git: { getStatus: mocks.getStatus },
  }),
  useMaterializeRepoRootMutation: () => ({ mutateAsync: vi.fn() }),
  useMaterializeWorkspaceAtRefMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCreateLocalMaterializationIntent: () => ({ mutateAsync: vi.fn() }),
  useReportMaterialization: () => ({ mutateAsync: vi.fn() }),
  useUnlinkMaterialization: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({
  createCloudWorkspace: (...args: unknown[]) => mocks.createCloudWorkspace(...args),
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({ cloudComputeEnabled: mocks.cloudComputeEnabled }),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: mocks.selectWorkspace }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({
  useWorkspaceCollectionsInvalidationActions: () => ({
    invalidateWorkspaceCollectionsForRuntime: vi.fn(),
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-desktop-install-id", () => ({
  useDesktopInstallId: () => "mac-a",
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ show: mocks.showToast }),
}));

const CLEAN_STATUS = {
  detached: false,
  currentBranch: "feat/x",
  clean: true,
  conflicted: false,
  operation: "none",
  workspacePath: "/tmp/ws-1",
  headOid: "abc123",
};

describe("useWorkspaceAvailabilityActions.addCloudCopy (PRO-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudComputeEnabled = true;
    mocks.getStatus.mockResolvedValue(CLEAN_STATUS);
    mocks.createCloudWorkspace.mockResolvedValue({ id: "cloud-1" });
  });

  afterEach(() => {
    cleanup();
  });

  it("never calls the Cloud SDK and surfaces the unavailable message when cloud compute is disabled", async () => {
    mocks.cloudComputeEnabled = false;
    const { result } = renderHook(() => useWorkspaceAvailabilityActions());

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.addCloudCopy({
        localAnyharnessWorkspaceId: "ws-1",
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
      });
    });

    expect(outcome).toBe(false);
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.createCloudWorkspace).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Cloud workspaces are temporarily unavailable.",
    );
  });

  it("proceeds and calls the Cloud SDK when cloud compute is enabled (negative control)", async () => {
    mocks.cloudComputeEnabled = true;
    const { result } = renderHook(() => useWorkspaceAvailabilityActions());

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.addCloudCopy({
        localAnyharnessWorkspaceId: "ws-1",
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
      });
    });

    expect(outcome).toBe(true);
    expect(mocks.getStatus).toHaveBeenCalledWith("ws-1");
    expect(mocks.createCloudWorkspace).toHaveBeenCalledTimes(1);
  });
});
