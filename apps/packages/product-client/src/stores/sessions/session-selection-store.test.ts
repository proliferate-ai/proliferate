import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HotPaintGate } from "#product/lib/domain/sessions/hot-paint-gate";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

describe("session selection store invariants", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      _hydrated: false,
      pendingWorkspaces: EMPTY_PENDING_WORKSPACE_REGISTRY,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      workspaceArrivalEvent: null,
      workspaceSessionRecovery: null,
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
      pendingWorkspaces: registryOf(pendingWorkspaceEntry()),
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
      pendingWorkspaces: registryOf(pendingWorkspaceEntry()),
      workspaceArrivalEvent: {
        workspaceId: "workspace-a",
        source: "local-created",
        receiptClientSessionId: "session-old",
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
      // Selection is a camera: switching does not end the attempt (PRO-230).
      pendingWorkspaces: registryOf(pendingWorkspaceEntry()),
      selectedLogicalWorkspaceId: "logical-a",
      selectedWorkspaceId: "workspace-a",
      workspaceSelectionNonce: 1,
      workspaceArrivalEvent: {
        workspaceId: "workspace-a",
        source: "local-created",
        receiptClientSessionId: "session-old",
        createdAt: 100,
      },
      activeSessionId: "session-a",
      activeSessionVersion: 3,
      hotPaintGate: gate,
    });
  });

  it("deselects workspace shell state without clearing cached session metadata", () => {
    useSessionSelectionStore.setState({
      pendingWorkspaces: registryOf(pendingWorkspaceEntry()),
      selectedLogicalWorkspaceId: "logical-a",
      selectedWorkspaceId: "workspace-a",
      workspaceSelectionNonce: 4,
      workspaceArrivalEvent: {
        workspaceId: "workspace-a",
        source: "local-created",
        receiptClientSessionId: "session-a",
        createdAt: 100,
      },
      activeSessionId: "session-a",
      activeSessionVersion: 7,
      sessionActivationIntentEpochByWorkspace: { "workspace-a": 3 },
      hotPaintGate: hotGate({ workspaceId: "workspace-a", sessionId: "session-a", nonce: 12 }),
    });

    useSessionSelectionStore.getState().deselectWorkspacePreservingSessions();

    expect(useSessionSelectionStore.getState()).toMatchObject({
      pendingWorkspaces: registryOf(pendingWorkspaceEntry()),
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

  it("aborts the prior selection controller and mints a fresh one on every nonce bump", () => {
    // UX Latency ADR §4.6, Rung 9 (Q11): the selection abort controller is the
    // single source of truth for selection staleness. Each nonce-bumping
    // activation must abort the outgoing selection's signal (cancelling its
    // in-flight requests) and install a live controller for the incoming one.
    const initial = new AbortController();
    useSessionSelectionStore.setState({ workspaceSelectionAbort: initial });

    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-a",
      workspaceId: "workspace-a",
    });
    const afterA = useSessionSelectionStore.getState().workspaceSelectionAbort;
    expect(initial.signal.aborted).toBe(true);
    expect(afterA).not.toBe(initial);
    expect(afterA.signal.aborted).toBe(false);

    useSessionSelectionStore.getState().activateHotWorkspace({
      logicalWorkspaceId: "logical-b",
      workspaceId: "workspace-b",
    });
    expect(afterA.signal.aborted).toBe(true);
    expect(useSessionSelectionStore.getState().workspaceSelectionAbort.signal.aborted).toBe(false);
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

  it("keeps one attempt per id and clears only the attempt asked for", () => {
    const store = useSessionSelectionStore.getState();
    store.setPendingWorkspaceEntry(pendingWorkspaceEntry("attempt-a"));
    store.setPendingWorkspaceEntry(pendingWorkspaceEntry("attempt-b"));

    expect(useSessionSelectionStore.getState().pendingWorkspaces.attemptOrder)
      .toEqual(["attempt-a", "attempt-b"]);

    useSessionSelectionStore.getState().clearPendingWorkspaceEntry("attempt-a");

    expect(useSessionSelectionStore.getState().pendingWorkspaces)
      .toEqual(registryOf(pendingWorkspaceEntry("attempt-b")));
  });

  it("drops every attempt on a full selection reset", () => {
    useSessionSelectionStore.setState({
      pendingWorkspaces: registryOf(
        pendingWorkspaceEntry("attempt-a"),
        pendingWorkspaceEntry("attempt-b"),
      ),
    });

    useSessionSelectionStore.getState().clearSelection();

    expect(useSessionSelectionStore.getState().pendingWorkspaces)
      .toBe(EMPTY_PENDING_WORKSPACE_REGISTRY);
  });

  it("keeps every attempt when the reset is scoped to one workspace", () => {
    // Retiring a workspace, or dismissing one attempt, routes through
    // `clearSelection` to deselect. Dropping the registry there would abort
    // every other launch in flight (PRO-230).
    const registry = registryOf(
      pendingWorkspaceEntry("attempt-a"),
      pendingWorkspaceEntry("attempt-b"),
    );
    useSessionSelectionStore.setState({
      pendingWorkspaces: registry,
      selectedWorkspaceId: "workspace-a",
      selectedLogicalWorkspaceId: "logical-a",
    });

    useSessionSelectionStore.getState().clearSelection({ preservePendingWorkspaces: true });

    expect(useSessionSelectionStore.getState().pendingWorkspaces).toBe(registry);
    expect(useSessionSelectionStore.getState().selectedWorkspaceId).toBeNull();
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId).toBeNull();
  });

  it("keeps inline recovery when the retained shell is reactivated", () => {
    useSessionSelectionStore.setState({
      workspaceSessionRecovery: {
        workspaceId: "workspace-a",
        logicalWorkspaceId: "logical-a",
        sessionId: "session-recovery",
        reason: "session-list-failed",
      },
    });

    useSessionSelectionStore.getState().setActiveSessionId("session-recovery");

    expect(useSessionSelectionStore.getState().workspaceSessionRecovery?.sessionId)
      .toBe("session-recovery");

    useSessionSelectionStore.getState().setActiveSessionId("session-a");

    expect(useSessionSelectionStore.getState().workspaceSessionRecovery).toBeNull();
  });
});

function registryOf(...entries: PendingWorkspaceEntry[]) {
  return entries.reduce(upsertPendingWorkspaceEntry, EMPTY_PENDING_WORKSPACE_REGISTRY);
}

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

function pendingWorkspaceEntry(attemptId = "attempt-a"): PendingWorkspaceEntry {
  return {
    attemptId,
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
