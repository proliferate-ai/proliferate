import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { resetLatencyFlowsForTest } from "#product/lib/infra/measurement/measurement-port";
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

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({}));

// UX Latency ADR §4.6, Rung 10 (Q12): the agent catalog must leave the blocking
// workspace-switch bootstrap and race the connection/directory chain from
// selection entry; the composer-submit gate (tested separately) awaits its
// readiness at send time. These tests pin the ORDER (prefetch starts before
// connection resolution and bootstrap) and that the switch never AWAITS the
// catalog (a catalog that never settles cannot stall the switch).
describe("runWorkspaceSelection agent-catalog parallelization", () => {
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
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValue({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValue({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "ah-workspace",
        runtimeGeneration: 0,
      },
    });
  });

  it("fires the background catalog prefetch before connection resolution and bootstrap", async () => {
    const order: string[] = [];
    vi.mocked(resolveSelectionConnection).mockImplementation(async () => {
      order.push("connection");
      return {
        runtimeUrl: "http://runtime.test",
        workspaceConnection: {
          runtimeUrl: "http://runtime.test",
          anyharnessWorkspaceId: "ah-workspace",
          runtimeGeneration: 0,
        },
      };
    });
    const bootstrapWorkspace = vi.fn(async () => {
      order.push("bootstrap");
      return { sessions: [] };
    });
    const prefetchAgentCatalog = vi.fn(() => {
      order.push("prefetch");
    });

    await runWorkspaceSelection(
      depsFor({ bootstrapWorkspace, prefetchAgentCatalog }),
      { workspaceId: "workspace-1" },
    );

    expect(prefetchAgentCatalog).toHaveBeenCalledTimes(1);
    // Parallel-start: the catalog warm is kicked off first, then the
    // connection/directory chain proceeds. NEGATIVE CONTROL: moving the
    // `deps.prefetchAgentCatalog?.()` call below `resolveSelectionConnection`
    // (re-serializing it) flips these indices and fails this assertion.
    expect(order.indexOf("prefetch")).toBeLessThan(order.indexOf("connection"));
    expect(order.indexOf("connection")).toBeLessThan(order.indexOf("bootstrap"));
  });

  it("does not await the catalog: a never-settling prefetch cannot stall the switch", async () => {
    // The prefetch here starts work that never resolves. Because selection fires
    // it fire-and-forget (`deps.prefetchAgentCatalog?.()`, no await), bootstrap
    // must still run to completion and the selection must settle on the target.
    let bootstrapReached = false;
    const bootstrapWorkspace = vi.fn(async () => {
      bootstrapReached = true;
      return { sessions: [] };
    });
    const prefetchAgentCatalog = vi.fn(() => {
      // Simulates ensureCloudAgentCatalog()'s in-flight promise never resolving.
      void new Promise<void>(() => {});
    });

    await runWorkspaceSelection(
      depsFor({ bootstrapWorkspace, prefetchAgentCatalog }),
      { workspaceId: "workspace-1" },
    );

    expect(prefetchAgentCatalog).toHaveBeenCalledTimes(1);
    expect(bootstrapReached).toBe(true);
    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-1");
  });

  it("is optional: selection runs when no prefetch is wired", async () => {
    const bootstrapWorkspace = vi.fn(async () => ({ sessions: [] }));
    await expect(
      runWorkspaceSelection(
        depsFor({ bootstrapWorkspace, prefetchAgentCatalog: undefined }),
        { workspaceId: "workspace-1" },
      ),
    ).resolves.toBeUndefined();
    expect(bootstrapWorkspace).toHaveBeenCalledTimes(1);
  });
});

function depsFor(overrides: {
  bootstrapWorkspace: WorkspaceSelectionDeps["bootstrapWorkspace"];
  prefetchAgentCatalog: WorkspaceSelectionDeps["prefetchAgentCatalog"];
}): WorkspaceSelectionDeps {
  return {
    localRuntime: null,
    cloudClient: null,
    cache: {
      cancelPreviousWorkspaceDisplayQueries: vi.fn(),
      invalidateCloudWorkspaceStartState: vi.fn().mockResolvedValue(undefined),
      refreshCloudWorkspaceConnection: vi.fn(),
    },
    logicalWorkspaces: [logicalFor("workspace-1")],
    rawWorkspaces: [],
    prefetchAgentCatalog: overrides.prefetchAgentCatalog,
    setSelectedLogicalWorkspaceId: vi.fn(),
    setSelectedWorkspace: (workspaceId, options) => {
      useSessionSelectionStore.getState().activateWorkspace({
        logicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
        workspaceId,
        initialActiveSessionId: options?.initialActiveSessionId,
      });
    },
    removeWorkspaceSlots: vi.fn(),
    clearSelection: vi.fn(),
    bootstrapWorkspace: overrides.bootstrapWorkspace,
    reconcileHotWorkspace: vi.fn(),
  };
}

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
