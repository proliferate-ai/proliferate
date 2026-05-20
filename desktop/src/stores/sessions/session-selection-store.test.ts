import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HotPaintGate } from "@/lib/domain/sessions/hot-paint-gate";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

describe("session selection store invariants", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      _hydrated: false,
      pendingWorkspaceEntry: null,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      workspaceArrivalEvent: null,
      activeSessionId: null,
      activeSessionVersion: 0,
      sessionActivationIntentEpochByWorkspace: {},
      hotPaintGate: null,
    });
  });

  it("hydrates persisted logical workspace selection without activating a workspace", () => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-live",
      activeSessionId: "session-live",
      activeSessionVersion: 4,
      workspaceSelectionNonce: 2,
    });

    useSessionSelectionStore.getState()
      .hydrateSelectedLogicalWorkspaceSelection("workspace-persisted");

    expect(useSessionSelectionStore.getState()).toMatchObject({
      _hydrated: true,
      selectedLogicalWorkspaceId: "workspace-persisted",
      selectedWorkspaceId: "workspace-live",
      workspaceSelectionNonce: 2,
      activeSessionId: "session-live",
      activeSessionVersion: 4,
    });
  });

  it("enters pending workspace shell as one local selection transaction", () => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-a",
      activeSessionId: "session-a",
      activeSessionVersion: 2,
      hotPaintGate: hotGate({ workspaceId: "workspace-a", sessionId: "session-a", nonce: 8 }),
    });
    const listener = vi.fn();
    const unsubscribe = useSessionSelectionStore.subscribe(listener);

    useSessionSelectionStore.getState().enterPendingWorkspaceShell(pendingWorkspaceEntry());

    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useSessionSelectionStore.getState()).toMatchObject({
      pendingWorkspaceEntry: pendingWorkspaceEntry(),
      selectedLogicalWorkspaceId: "pending-workspace:attempt-a",
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 1,
      workspaceArrivalEvent: null,
      activeSessionId: null,
      activeSessionVersion: 3,
      hotPaintGate: null,
    });
  });

  it("activates workspace, session, arrival, and hot gate fields atomically", () => {
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: pendingWorkspaceEntry(),
      workspaceArrivalEvent: {
        workspaceId: "workspace-a",
        source: "local-created",
        createdAt: 100,
      },
      activeSessionId: "session-old",
      activeSessionVersion: 2,
    });
    const gate = hotGate({
      workspaceId: "workspace-a",
      sessionId: "session-a",
      nonce: 11,
    });
    const listener = vi.fn();
    const unsubscribe = useSessionSelectionStore.subscribe(listener);

    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-a",
      workspaceId: "workspace-a",
      initialActiveSessionId: "session-a",
      hotPaintGate: gate,
    });

    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useSessionSelectionStore.getState()).toMatchObject({
      pendingWorkspaceEntry: null,
      selectedLogicalWorkspaceId: "logical-a",
      selectedWorkspaceId: "workspace-a",
      workspaceSelectionNonce: 1,
      workspaceArrivalEvent: {
        workspaceId: "workspace-a",
        source: "local-created",
        createdAt: 100,
      },
      activeSessionId: "session-a",
      activeSessionVersion: 3,
      hotPaintGate: gate,
    });
  });

  it("deselects workspace shell state without clearing cached session metadata", () => {
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: pendingWorkspaceEntry(),
      selectedLogicalWorkspaceId: "logical-a",
      selectedWorkspaceId: "workspace-a",
      workspaceSelectionNonce: 4,
      workspaceArrivalEvent: {
        workspaceId: "workspace-a",
        source: "local-created",
        createdAt: 100,
      },
      activeSessionId: "session-a",
      activeSessionVersion: 7,
      sessionActivationIntentEpochByWorkspace: { "workspace-a": 3 },
      hotPaintGate: hotGate({ workspaceId: "workspace-a", sessionId: "session-a", nonce: 12 }),
    });

    useSessionSelectionStore.getState().deselectWorkspacePreservingSessions();

    expect(useSessionSelectionStore.getState()).toMatchObject({
      pendingWorkspaceEntry: null,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 5,
      workspaceArrivalEvent: null,
      activeSessionId: null,
      activeSessionVersion: 8,
      sessionActivationIntentEpochByWorkspace: { "workspace-a": 3 },
      hotPaintGate: null,
    });
  });

  it("bumps hot workspace intent only for hot activation and keeps session version stable for same session", () => {
    useSessionSelectionStore.setState({
      activeSessionId: "session-a",
      activeSessionVersion: 5,
      sessionActivationIntentEpochByWorkspace: { "workspace-a": 3 },
    });

    useSessionSelectionStore.getState().activateHotWorkspace({
      logicalWorkspaceId: "workspace-a",
      workspaceId: "workspace-a",
      initialActiveSessionId: "session-a",
    });

    expect(useSessionSelectionStore.getState()).toMatchObject({
      selectedLogicalWorkspaceId: "workspace-a",
      selectedWorkspaceId: "workspace-a",
      workspaceSelectionNonce: 1,
      activeSessionId: "session-a",
      activeSessionVersion: 5,
      sessionActivationIntentEpochByWorkspace: { "workspace-a": 4 },
      hotPaintGate: null,
    });
  });

  it("clears hot paint gates only for the matching nonce", () => {
    useSessionSelectionStore.setState({
      hotPaintGate: hotGate({ nonce: 12 }),
    });

    useSessionSelectionStore.getState().clearHotPaintGate(11);
    expect(useSessionSelectionStore.getState().hotPaintGate?.nonce).toBe(12);

    useSessionSelectionStore.getState().clearHotPaintGate(12);
    expect(useSessionSelectionStore.getState().hotPaintGate).toBeNull();
  });
});

function hotGate(overrides: Partial<HotPaintGate> = {}): HotPaintGate {
  return {
    kind: "workspace_hot_reopen",
    workspaceId: "workspace-a",
    sessionId: "session-a",
    nonce: 1,
    operationId: null,
    ...overrides,
  };
}

function pendingWorkspaceEntry(): PendingWorkspaceEntry {
  return {
    attemptId: "attempt-a",
    source: "local-created",
    stage: "submitting",
    displayName: "Workspace A",
    repoLabel: null,
    baseBranchName: null,
    workspaceId: null,
    request: { kind: "local", sourceRoot: "/tmp/workspace-a" },
    originTarget: { kind: "home" },
    errorMessage: null,
    setupScript: null,
    createdAt: 100,
  };
}
