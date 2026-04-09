import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import {
  listActiveLatencyFlows,
  resetLatencyFlowsForTest,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";
import { runWorkspaceSelection } from "./run-workspace-selection";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";

vi.mock("./cloud-readiness", () => ({
  resolveCloudWorkspaceReadiness: vi.fn(),
}));

describe("runWorkspaceSelection", () => {
  beforeEach(() => {
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
});
