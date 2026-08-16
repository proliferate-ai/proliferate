import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  useSessionSelectionStore,
  WORKSPACE_SELECTION_SUPERSEDED_REASON,
} from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  listActiveLatencyFlows,
  resetLatencyFlowsForTest,
  startLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { runWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/run-workspace-selection";
import { resolveCloudWorkspaceReadiness } from "#product/hooks/workspaces/workflows/selection/cloud-readiness";
import { resolveSelectionConnection } from "#product/hooks/workspaces/workflows/selection/connection";
import type { WorkspaceSelectionDeps } from "#product/hooks/workspaces/workflows/selection/types";

vi.mock("./cloud-readiness", () => ({
  resolveCloudWorkspaceReadiness: vi.fn(),
}));

vi.mock("./connection", () => ({
  resolveSelectionConnection: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({
}));

describe("runWorkspaceSelection staleness abort", () => {
  beforeEach(() => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockReset();
    vi.mocked(resolveSelectionConnection).mockReset();
    resetLatencyFlowsForTest();
    useSessionSelectionStore.setState({
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      activeSessionId: null,
      workspaceArrivalEvent: null,
      workspaceSelectionAbort: new AbortController(),
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useWorkspaceUiStore.setState({
      lastViewedSessionByWorkspace: {},
      visibleChatSessionIdsByWorkspace: {},
    });
  });

  it("aborts a superseded selection's in-flight bootstrap fetch on the wire (A→B→C staggered)", async () => {
    // UX Latency ADR §4.6, Rung 9 (Q11): a newer selection must abort the prior
    // selection's in-flight requests on the wire, not merely discard their
    // resolved results. Fixture: select A, then B, then C with A's bootstrap
    // still in flight; assert A's (and B's) request signal fired with the
    // supersession reason, A's late result is discarded, and staleness state
    // converges on C.
    const logicals = [
      logicalFor("workspace-1"),
      logicalFor("workspace-2"),
      logicalFor("workspace-3"),
    ];
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValue({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValue({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "ah-workspace",
      },
    });

    const capturedSignals: Record<string, AbortSignal> = {};
    const releaseById: Record<string, () => void> = {};
    const bootstrapWorkspace = vi.fn(async (input: { workspaceId: string; signal: AbortSignal }) => {
      capturedSignals[input.workspaceId] = input.signal;
      await new Promise<void>((resolve) => {
        releaseById[input.workspaceId] = resolve;
      });
      return { sessions: [] };
    });

    const runFor = (workspaceId: string, flowId: string) =>
      runWorkspaceSelection({
        localRuntime: null,
        cloudClient: null,
        cache: selectionCache(),
        logicalWorkspaces: logicals,
        rawWorkspaces: [],
        setSelectedLogicalWorkspaceId: vi.fn(),
        setSelectedWorkspace,
        removeWorkspaceSlots: vi.fn(),
        clearSelection: vi.fn(),
        bootstrapWorkspace: bootstrapWorkspace as never,
        reconcileHotWorkspace: vi.fn(),
      }, { workspaceId, options: { latencyFlowId: flowId } });

    // The bootstrap chain has several awaits (readiness, connection, cache)
    // before it reaches bootstrap; poll on real timers until it lands.
    const waitForBootstrap = async (workspaceId: string) => {
      for (let attempt = 0; attempt < 50 && !capturedSignals[workspaceId]; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    const flowA = startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: "workspace-1",
    });
    const pA = runFor("workspace-1", flowA);
    await waitForBootstrap("workspace-1");
    expect(capturedSignals["workspace-1"]).toBeDefined();
    expect(capturedSignals["workspace-1"].aborted).toBe(false);

    // Selecting B supersedes A synchronously in B's activation prelude.
    const flowB = startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: "workspace-2",
    });
    const pB = runFor("workspace-2", flowB);
    expect(capturedSignals["workspace-1"].aborted).toBe(true);
    expect(capturedSignals["workspace-1"].reason).toBe(WORKSPACE_SELECTION_SUPERSEDED_REASON);
    await waitForBootstrap("workspace-2");
    expect(capturedSignals["workspace-2"]).toBeDefined();
    expect(capturedSignals["workspace-2"].aborted).toBe(false);

    // Selecting C supersedes B.
    const flowC = startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: "workspace-3",
    });
    const pC = runFor("workspace-3", flowC);
    expect(capturedSignals["workspace-2"].aborted).toBe(true);
    await waitForBootstrap("workspace-3");
    expect(capturedSignals["workspace-3"]).toBeDefined();
    expect(capturedSignals["workspace-3"].aborted).toBe(false);

    // Resolve staggered, A last: its late result must not resurrect selection A.
    releaseById["workspace-1"]();
    releaseById["workspace-2"]();
    releaseById["workspace-3"]();
    await Promise.all([pA, pB, pC]);

    // Staleness converges on C; the superseded A/B flows were cancelled.
    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-3");
    expect(useSessionSelectionStore.getState().workspaceSelectionNonce).toBe(3);
    const activeFlowIds = listActiveLatencyFlows().map((flow) => flow.flowId);
    expect(activeFlowIds).not.toContain(flowA);
    expect(activeFlowIds).not.toContain(flowB);
  });
});

function logicalFor(workspaceId: string): LogicalWorkspace {
  return {
    id: `logical:${workspaceId}`,
    repoKey: `repo-${workspaceId}`,
    sourceRoot: `/tmp/${workspaceId}`,
    repoRoot: null,
    provider: null,
    owner: null,
    repoName: workspaceId,
    branchKey: "main",
    displayName: workspaceId,
    localWorkspace: { id: workspaceId } as never,
    cloudWorkspace: null,
    mobilityWorkspace: null,
    preferredMaterializationId: workspaceId,
    effectiveOwner: "local",
    lifecycle: "local_active",
    updatedAt: new Date().toISOString(),
  };
}

function selectionCache(): WorkspaceSelectionDeps["cache"] {
  return {
    cancelPreviousWorkspaceDisplayQueries: vi.fn(),
    invalidateCloudWorkspaceStartState: vi.fn().mockResolvedValue(undefined),
    refreshCloudWorkspaceConnection: vi.fn(),
  };
}

function setSelectedWorkspace(
  workspaceId: string,
  options?: { initialActiveSessionId?: string | null; clearPending?: boolean },
): void {
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
    workspaceId,
    initialActiveSessionId: options?.initialActiveSessionId,
    clearPending: options?.clearPending,
  });
}
