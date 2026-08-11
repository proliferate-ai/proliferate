import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { resolveWorkspaceShellActivation } from "#product/lib/domain/workspaces/tabs/shell-activation";
import { chatWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { runHotWorkspaceReopen } from "#product/hooks/workspaces/workflows/selection/run-hot-workspace-reopen";
import { resolveCloudWorkspaceReadiness } from "#product/hooks/workspaces/workflows/selection/cloud-readiness";
import { resolveSelectionConnection } from "#product/hooks/workspaces/workflows/selection/connection";
import type { WorkspaceSelectionDeps } from "#product/hooks/workspaces/workflows/selection/types";

vi.mock("./cloud-readiness", () => ({
  resolveCloudWorkspaceReadiness: vi.fn(),
}));

vi.mock("./connection", () => ({
  resolveSelectionConnection: vi.fn(),
}));

vi.mock("./run-workspace-selection", () => ({
  runWorkspaceSelection: vi.fn(),
}));

describe("runHotWorkspaceReopen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(resolveCloudWorkspaceReadiness).mockResolvedValue({ kind: "local" });
    vi.mocked(resolveSelectionConnection).mockResolvedValue({
      runtimeUrl: "http://runtime.test",
      workspaceConnection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "workspace-1",
      },
    });
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      activeSessionId: null,
      sessionActivationIntentEpochByWorkspace: {},
      hotPaintGate: null,
      pendingWorkspaceEntry: null,
      workspaceArrivalEvent: null,
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    putSessionRecord({
      ...createEmptySessionRecord("session-1", "codex", {
        workspaceId: "workspace-1",
      }),
      transcriptHydrated: true,
    });
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      lastViewedSessionByWorkspace: {
        "workspace-1": "session-1",
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("activates a cached workspace and session without calling cold bootstrap", () => {
    const deps = depsForHotReopen();

    const didHotReopen = runHotWorkspaceReopen(deps, {
      workspaceId: "workspace-1",
    });

    const state = useSessionSelectionStore.getState();
    expect(didHotReopen).toBe(true);
    expect(state.selectedWorkspaceId).toBe("workspace-1");
    expect(state.activeSessionId).toBe("session-1");
    expect(state.hotPaintGate).toMatchObject({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      kind: "workspace_hot_reopen",
    });
    expect(deps.bootstrapWorkspace).not.toHaveBeenCalled();
    expect(deps.reconcileHotWorkspace).not.toHaveBeenCalled();
  });

  it("clears the hot gate after paint and starts guarded reconcile", async () => {
    const deps = depsForHotReopen();

    runHotWorkspaceReopen(deps, {
      workspaceId: "workspace-1",
    });

    expect(useSessionSelectionStore.getState().hotPaintGate).not.toBeNull();
    await vi.runOnlyPendingTimersAsync();

    expect(useSessionSelectionStore.getState().hotPaintGate).toBeNull();
    expect(deps.reconcileHotWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        logicalWorkspaceId: "workspace-1",
        sessionId: "session-1",
        selectionNonce: 1,
      }),
    );
    expect(deps.bootstrapWorkspace).not.toHaveBeenCalled();
  });

  it("aborts stale reconcile when selection changes before paint", async () => {
    const deps = depsForHotReopen();

    runHotWorkspaceReopen(deps, {
      workspaceId: "workspace-1",
    });
    setSelectedWorkspace("workspace-2");
    await vi.runOnlyPendingTimersAsync();

    expect(deps.reconcileHotWorkspace).not.toHaveBeenCalled();
    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBe("workspace-2");
  });

  it("reopens the client slot behind a durable last-viewed id without blanking the shell", () => {
    const clientSessionA = "client-session:codex:older";
    const clientSessionB = "client-session:codex:new-empty";
    const runtimeSessionB = "runtime-session-new-empty";
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    putSessionRecord({
      ...createEmptySessionRecord(clientSessionA, "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: "runtime-session-older",
      }),
      transcriptHydrated: true,
    });
    putSessionRecord({
      ...createEmptySessionRecord(clientSessionB, "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: runtimeSessionB,
      }),
      transcriptHydrated: true,
    });
    const logicalWorkspace = localLogicalWorkspace();
    const intent = chatWorkspaceShellTabKey(clientSessionB);
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      activeShellTabKeyByWorkspace: {
        [logicalWorkspace.id]: intent,
      },
      lastViewedSessionByWorkspace: {
        [logicalWorkspace.id]: runtimeSessionB,
      },
      visibleChatSessionIdsByWorkspace: {
        [logicalWorkspace.id]: [clientSessionA, clientSessionB],
      },
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: logicalWorkspace.id,
      workspaceId: "workspace-1",
      initialActiveSessionId: clientSessionB,
    });
    useSessionSelectionStore.getState().deselectWorkspacePreservingSessions();
    const deps = depsForHotReopen([logicalWorkspace]);

    const didHotReopen = runHotWorkspaceReopen(deps, {
      workspaceId: logicalWorkspace.id,
    });

    const state = useSessionSelectionStore.getState();
    expect(didHotReopen).toBe(true);
    expect(state.selectedLogicalWorkspaceId).toBe(logicalWorkspace.id);
    expect(state.selectedWorkspaceId).toBe("workspace-1");
    expect(state.activeSessionId).toBe(clientSessionB);
    expect(resolveWorkspaceShellActivation({
      workspaceId: "workspace-1",
      storedIntent: intent,
      orderedTabs: [
        chatWorkspaceShellTabKey(clientSessionA),
        chatWorkspaceShellTabKey(clientSessionB),
      ],
      activeSessionId: state.activeSessionId,
      activeViewerTargetKey: null,
      liveChatSessionIds: new Set([clientSessionA, clientSessionB]),
      openViewerTargetKeys: new Set(),
      pendingChatActivation: null,
      currentShellActivationEpoch: 0,
      currentSessionActivationEpoch:
        state.sessionActivationIntentEpochByWorkspace["workspace-1"] ?? 0,
      currentWorkspaceSelectionNonce: state.workspaceSelectionNonce,
    })).toEqual({
      renderSurface: { kind: "chat-session", sessionId: clientSessionB },
      highlightedTabKey: intent,
    });
    expect(deps.bootstrapWorkspace).not.toHaveBeenCalled();
  });
});

function depsForHotReopen(
  logicalWorkspaces: LogicalWorkspace[] = [],
): WorkspaceSelectionDeps {
  return {
    localRuntime: null,
    cloudClient: null,
    cache: {
      cancelPreviousWorkspaceDisplayQueries: vi.fn(),
      invalidateCloudWorkspaceStartState: vi.fn().mockResolvedValue(undefined),
      refreshCloudWorkspaceConnection: vi.fn(),
    },
    logicalWorkspaces,
    rawWorkspaces: [{ id: "workspace-1" } as never, { id: "workspace-2" } as never],
    setSelectedLogicalWorkspaceId: vi.fn(),
    setSelectedWorkspace,
    removeWorkspaceSlots: vi.fn(),
    clearSelection: vi.fn(),
    bootstrapWorkspace: vi.fn(),
    reconcileHotWorkspace: vi.fn().mockResolvedValue("completed"),
  };
}

function localLogicalWorkspace(): LogicalWorkspace {
  return {
    id: "logical:workspace-1",
    localWorkspace: { id: "workspace-1" },
    cloudWorkspace: null,
    mobilityWorkspace: null,
    preferredMaterializationId: "workspace-1",
  } as LogicalWorkspace;
}

function setSelectedWorkspace(
  workspaceId: string,
  options?: { initialActiveSessionId?: string | null; clearPending?: boolean },
): void {
  useSessionSelectionStore.getState().activateWorkspace({
    logicalWorkspaceId: null,
    workspaceId,
    initialActiveSessionId: options?.initialActiveSessionId,
    clearPending: options?.clearPending,
  });
}
