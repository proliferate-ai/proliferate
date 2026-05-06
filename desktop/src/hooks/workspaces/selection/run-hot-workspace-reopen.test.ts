import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { runHotWorkspaceReopen } from "./run-hot-workspace-reopen";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { resolveSelectionConnection } from "./connection";
import type { WorkspaceSelectionDeps } from "./types";

vi.mock("./cloud-readiness", () => ({
  resolveCloudWorkspaceReadiness: vi.fn(),
}));

vi.mock("./connection", () => ({
  resolveSelectionConnection: vi.fn(),
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
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      activeSessionId: null,
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
});

function depsForHotReopen(): WorkspaceSelectionDeps {
  return {
    queryClient: {} as never,
    logicalWorkspaces: [],
    rawWorkspaces: [{ id: "workspace-1" } as never, { id: "workspace-2" } as never],
    setSelectedLogicalWorkspaceId: vi.fn(),
    setSelectedWorkspace,
    removeWorkspaceSlots: vi.fn(),
    clearSelection: vi.fn(),
    bootstrapWorkspace: vi.fn(),
    reconcileHotWorkspace: vi.fn().mockResolvedValue("completed"),
  };
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
