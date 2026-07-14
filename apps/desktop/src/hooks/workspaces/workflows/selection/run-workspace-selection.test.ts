import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { chatWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  listActiveLatencyFlows,
  resetLatencyFlowsForTest,
  startLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { buildLocalSlotLogicalWorkspaceId } from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import { runWorkspaceSelection } from "./run-workspace-selection";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { resolveSelectionConnection } from "./connection";
import type { WorkspaceSelectionDeps } from "./types";

vi.mock("./cloud-readiness", () => ({
  resolveCloudWorkspaceReadiness: vi.fn(),
}));

vi.mock("./connection", () => ({
  resolveSelectionConnection: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/workspaces", () => ({
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
    resetLatencyFlowsForTest();
    useSessionSelectionStore.setState({
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      activeSessionId: null,
      pendingWorkspaceEntry: null,
      workspaceArrivalEvent: null,
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useWorkspaceUiStore.setState({
      lastViewedSessionByWorkspace: {},
      visibleChatSessionIdsByWorkspace: {},
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
      localRuntime: null,
      cache: selectionCache(),
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace,
      reconcileHotWorkspace: vi.fn(),
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
      localRuntime: null,
      cache: selectionCache(),
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
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace: vi.fn(),
      reconcileHotWorkspace: vi.fn(),
    }, {
      workspaceId: "logical:placeholder",
    })).rejects.toThrow("Workspace is not materialized yet.");

    expect(resolveCloudWorkspaceReadiness).not.toHaveBeenCalled();
  });

  it("refreshes cloud workspace status when connection metadata is stale", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce({
      kind: "cloud-ready",
      cloudWorkspaceId: "cloud-1",
    });
    vi.mocked(resolveSelectionConnection).mockRejectedValueOnce(
      new ProliferateClientError("not ready", 409, "workspace_not_ready"),
    );
    const bootstrapWorkspace = vi.fn();
    const cache = selectionCache();
    const flowId = startLatencyFlow({
      flowKind: "workspace_switch",
      source: "sidebar",
      targetWorkspaceId: "workspace-1",
    });

    await runWorkspaceSelection({
      localRuntime: null,
      cache,
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace,
      reconcileHotWorkspace: vi.fn(),
    }, {
      workspaceId: "workspace-1",
      options: { latencyFlowId: flowId },
    });

    expect(cache.invalidateCloudWorkspaceStartState).toHaveBeenCalledTimes(1);
    expect(bootstrapWorkspace).not.toHaveBeenCalled();
    expect(listActiveLatencyFlows()).toEqual([]);
  });

  it("opens a remembered session optimistically before bootstrap validates it", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValueOnce({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "ah-workspace-1",
      },
    });
    useWorkspaceUiStore.setState({
      lastViewedSessionByWorkspace: {
        "logical:workspace-1": "session-forgotten",
      },
    });

    await runWorkspaceSelection({
      localRuntime: null,
      cache: selectionCache(),
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace: vi.fn().mockResolvedValue({ sessions: [] }),
      reconcileHotWorkspace: vi.fn(),
    }, {
      workspaceId: "workspace-1",
    });

    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-1");
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("session-forgotten");
    expect(getSessionRecord("session-forgotten")).toMatchObject({
      agentKind: "",
      materializedSessionId: "session-forgotten",
      title: "Chat",
      workspaceId: "workspace-1",
    });
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["logical:workspace-1"])
      .toBe(chatWorkspaceShellTabKey("session-forgotten"));
  });

  it("normalizes a stale local-slot selection and reads alias-keyed session state", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValueOnce({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "ah-workspace-1",
      },
    });
    const staleSlotId = buildLocalSlotLogicalWorkspaceId("workspace-1");
    useWorkspaceUiStore.setState({
      lastViewedSessionByWorkspace: {
        [staleSlotId]: "session-from-slot",
      },
    });

    await runWorkspaceSelection({
      localRuntime: null,
      cache: selectionCache(),
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: (id) =>
        useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId(id),
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace: vi.fn().mockResolvedValue({ sessions: [] }),
      reconcileHotWorkspace: vi.fn(),
    }, {
      workspaceId: staleSlotId,
    });

    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId)
      .toBe("logical:workspace-1");
    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-1");
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("session-from-slot");
  });

  it("falls back to the first persisted visible chat tab when no last-viewed session exists", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValueOnce({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "ah-workspace-1",
      },
    });
    useWorkspaceUiStore.setState({
      visibleChatSessionIdsByWorkspace: {
        "logical:workspace-1": ["session-visible", "session-other"],
      },
    });

    await runWorkspaceSelection({
      localRuntime: null,
      cache: selectionCache(),
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace: vi.fn().mockResolvedValue({ sessions: [] }),
      reconcileHotWorkspace: vi.fn(),
    }, {
      workspaceId: "workspace-1",
    });

    expect(useSessionSelectionStore.getState().activeSessionId).toBe("session-visible");
    expect(getSessionRecord("session-visible")).toMatchObject({
      materializedSessionId: "session-visible",
      title: "Chat",
      workspaceId: "workspace-1",
    });
  });

  it("preserves an explicit initial active session even when the slot is not retained", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValueOnce({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "ah-workspace-1",
      },
    });

    await runWorkspaceSelection({
      localRuntime: null,
      cache: selectionCache(),
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: vi.fn(),
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace: vi.fn().mockResolvedValue({ sessions: [] }),
      reconcileHotWorkspace: vi.fn(),
    }, {
      workspaceId: "workspace-1",
      options: { initialActiveSessionId: "session-explicit" },
    });

    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-1");
    expect(useSessionSelectionStore.getState().activeSessionId).toBe("session-explicit");
  });

  it("does not materialize a pending projected client session during workspace selection", async () => {
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValueOnce({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValueOnce({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "ah-workspace-1",
      },
    });
    const pendingEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "worktree-created",
        displayName: "workspace-1",
        request: {
          kind: "worktree",
          input: {
            repoRootId: "repo-1",
            workspaceName: "workspace-1",
            branchName: "pablo/workspace-1",
            baseBranch: "main",
            targetPath: "/tmp/workspace-1",
          },
        },
      }),
      workspaceId: "workspace-1",
    };
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(pendingEntry);
    const projectedSessionId = "client-session:codex:1";
    useSessionSelectionStore.setState({ pendingWorkspaceEntry: pendingEntry });
    putSessionRecord(createEmptySessionRecord(projectedSessionId, "codex", {
      workspaceId: pendingWorkspaceUiKey,
      materializedSessionId: null,
      modelId: "gpt-5.5",
      modeId: "xhigh",
      sessionRelationship: { kind: "root" },
    }));

    const bootstrapWorkspace = vi.fn().mockImplementation(async () => {
      expect(getSessionRecord(projectedSessionId)).toMatchObject({
        workspaceId: pendingWorkspaceUiKey,
        materializedSessionId: null,
      });
      return { sessions: [] };
    });

    await runWorkspaceSelection({
      localRuntime: null,
      cache: selectionCache(),
      logicalWorkspaces,
      rawWorkspaces: [],
      setSelectedLogicalWorkspaceId: (id) =>
        useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId(id),
      setSelectedWorkspace,
      removeWorkspaceSlots: vi.fn(),
      clearSelection: vi.fn(),
      bootstrapWorkspace,
      reconcileHotWorkspace: vi.fn(),
    }, {
      workspaceId: "workspace-1",
      options: {
        force: true,
        preservePending: true,
        initialActiveSessionId: projectedSessionId,
      },
    });

    expect(bootstrapWorkspace).toHaveBeenCalledTimes(1);
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(projectedSessionId);
    expect(getSessionRecord(projectedSessionId)).toMatchObject({
      workspaceId: pendingWorkspaceUiKey,
      materializedSessionId: null,
    });
  });
});

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
