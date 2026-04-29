import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import {
  listActiveLatencyFlows,
  resetLatencyFlowsForTest,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { ProliferateClientError } from "@/lib/integrations/cloud/client";
import { startCloudWorkspace } from "@/lib/integrations/cloud/workspaces";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { runWorkspaceSelection } from "./run-workspace-selection";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { resolveSelectionConnection } from "./connection";

vi.mock("./cloud-readiness", () => ({
  resolveCloudWorkspaceReadiness: vi.fn(),
}));

vi.mock("./connection", () => ({
  resolveSelectionConnection: vi.fn(),
}));

vi.mock("@/lib/integrations/cloud/workspaces", () => ({
  startCloudWorkspace: vi.fn(),
}));

describe("runWorkspaceSelection", () => {
  const logicalWorkspaces: LogicalWorkspace[] = [
    {
      id: "logical:workspace-1",
      repoKey: "repo-1",
      sourceRoot: "/tmp/repo-1",
      repoRoot: null,
      provider: null,
      owner: null,
      repoName: "repo-1",
      branchKey: "main",
      displayName: "workspace-1",
      localWorkspace: {
        id: "workspace-1",
      } as never,
      cloudWorkspace: null,
      mobilityWorkspace: null,
      preferredMaterializationId: "workspace-1",
      effectiveOwner: "local",
      lifecycle: "local_active",
      updatedAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockReset();
    vi.mocked(resolveSelectionConnection).mockReset();
    vi.mocked(startCloudWorkspace).mockReset();
    resetLatencyFlowsForTest();
    useHarnessStore.setState({
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      activeSessionId: null,
      sessionSlots: {},
      pendingWorkspaceEntry: null,
      workspaceArrivalEvent: null,
    });
    useWorkspaceUiStore.setState({
      lastViewedSessionByWorkspace: {},
    });
  });

  it.each([
    { kind: "cloud-missing" as const, cloudWorkspaceId: "cloud-1" },
    {
      kind: "cloud-pending" as const,
      cloudWorkspaceId: "cloud-1",
      status: "starting",
    },
  ])("cancels latency flows when readiness returns $kind", async (cloudReadiness) => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce(cloudReadiness);
    const bootstrapWorkspace = vi.fn();
    const flowId = startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: "workspace-1",
    });

    await runWorkspaceSelection({
      queryClient: {} as never,
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace: useHarnessStore.getState().setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace,
    }, {
      workspaceId: "workspace-1",
      options: { latencyFlowId: flowId },
    });

    expect(listActiveLatencyFlows()).toEqual([]);
    expect(bootstrapWorkspace).not.toHaveBeenCalled();
  });

  it("rejects placeholder logical workspaces that are not materialized yet", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockReset();

    await expect(runWorkspaceSelection({
      queryClient: {} as never,
      logicalWorkspaces: [
        ...logicalWorkspaces,
        {
          id: "logical:placeholder",
          repoKey: "repo-placeholder",
          sourceRoot: "/tmp/repo-placeholder",
          repoRoot: null,
          provider: "github",
          owner: "proliferate-ai",
          repoName: "landing",
          branchKey: "seal",
          displayName: "seal",
          localWorkspace: null,
          cloudWorkspace: null,
          mobilityWorkspace: {
            id: "mobility-1",
          } as never,
          preferredMaterializationId: null,
          effectiveOwner: "local",
          lifecycle: "moving_to_cloud",
          updatedAt: new Date().toISOString(),
        },
      ],
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace: useHarnessStore.getState().setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace: vi.fn(),
    }, {
      workspaceId: "logical:placeholder",
    })).rejects.toThrow("Workspace is not materialized yet.");

    expect(resolveCloudWorkspaceReadiness).not.toHaveBeenCalled();
  });

  it("starts a ready cloud workspace when its connection metadata is stale", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce({
      kind: "cloud-ready",
      cloudWorkspaceId: "cloud-1",
    });
    vi.mocked(resolveSelectionConnection).mockRejectedValueOnce(
      new ProliferateClientError("not ready", 409, "workspace_not_ready"),
    );
    vi.mocked(startCloudWorkspace).mockResolvedValueOnce({
      status: "queued",
    } as never);
    const bootstrapWorkspace = vi.fn();
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const flowId = startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: "workspace-1",
    });

    await runWorkspaceSelection({
      queryClient: queryClient as never,
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace: useHarnessStore.getState().setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace,
    }, {
      workspaceId: "workspace-1",
      options: { latencyFlowId: flowId },
    });

    expect(startCloudWorkspace).toHaveBeenCalledWith("cloud-1");
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(bootstrapWorkspace).not.toHaveBeenCalled();
    expect(listActiveLatencyFlows()).toEqual([]);
  });
});
