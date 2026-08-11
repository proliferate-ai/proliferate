// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { Session } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import { chatWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { buildKnownHeaderSessions } from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import { publishCreatedSessionMaterialization } from "#product/hooks/sessions/workflows/session-creation-publication";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  getSessionIntentsForSession,
  useSessionIntentStore,
} from "#product/stores/sessions/session-intent-store";
import { classifyTrustedSessionSelection } from "#product/hooks/sessions/workflows/session-selection-relationship";
import { useSessionSelectionWorkflowActions } from "#product/hooks/sessions/workflows/use-session-selection-actions";
import {
  beginSessionActivationIntent,
  invalidateSessionActivationIntent,
} from "#product/hooks/sessions/workflows/session-activation-guard";
import type {
  WorkspaceSession,
} from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

afterEach(cleanup);

describe("classifyTrustedSessionSelection", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: null,
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      archivingChatSessionIdsByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      shellActivationEpochByWorkspace: {},
      urgentHighlightedChatSessionByWorkspace: {},
    });
  });

  it("promotes a pending mounted session to root when no child hint exists", () => {
    putSessionRecord(
      createEmptySessionRecord("root-session", "codex", {
        workspaceId: "workspace-1",
      }),
    );

    const relationship = classifyTrustedSessionSelection("root-session");

    expect(relationship).toEqual({ kind: "root" });
    expect(useSessionDirectoryStore.getState().entriesById["root-session"]?.sessionRelationship)
      .toEqual({ kind: "root" });
  });

  it("applies and prunes a known child hint instead of promoting to root", () => {
    putSessionRecord(createEmptySessionRecord("child-session", "codex", {
      workspaceId: "workspace-1",
    }));
    useSessionDirectoryStore.getState().recordRelationshipHint("child-session", {
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-1",
    });

    const relationship = classifyTrustedSessionSelection("child-session");

    expect(relationship).toEqual({
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-1",
    });
    expect(useSessionDirectoryStore.getState().entriesById["child-session"]?.sessionRelationship)
      .toEqual(relationship);
    expect(useSessionDirectoryStore.getState().relationshipHintsBySessionId["child-session"])
      .toBeUndefined();
  });
});

describe("guarded query-only session selection", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: "workspace-1",
      selectedWorkspaceId: "workspace-1",
      workspaceSelectionNonce: 1,
      activeSessionId: null,
      sessionActivationIntentEpochByWorkspace: {},
      hotPaintGate: null,
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      archivingChatSessionIdsByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      shellActivationEpochByWorkspace: {},
      urgentHighlightedChatSessionByWorkspace: {},
    });
  });

  it("does not publish a late authoritative slot after replacement invalidates activation", async () => {
    const sessionsGate = deferred<WorkspaceSession[]>();
    const ensureWorkspaceSessions = vi.fn(() => sessionsGate.promise);
    const activateSession = vi.fn();
    const { result } = renderHook(() => useSessionSelectionWorkflowActions({
      activateSession,
      ensureWorkspaceSessions,
    }));
    const guard = beginSessionActivationIntent("workspace-1");

    const selection = result.current.selectSession("runtime-reloaded-codex", {
      guard,
    });
    await vi.waitFor(() => expect(ensureWorkspaceSessions).toHaveBeenCalledOnce());

    // The replacement's shell-intent write performs this invalidation while
    // the post-reload activation is waiting on its authoritative session list.
    invalidateSessionActivationIntent("workspace-1");
    sessionsGate.resolve([{
      id: "runtime-reloaded-codex",
      workspaceId: "workspace-1",
      agentKind: "codex",
      modelId: "gpt-5",
      status: "idle",
      lastPromptAt: null,
    } as WorkspaceSession]);

    await expect(selection).resolves.toMatchObject({
      result: "stale",
      sessionId: "runtime-reloaded-codex",
      reason: "intent-replaced",
    });
    expect(getSessionRecord("runtime-reloaded-codex")).toBeNull();
    expect(activateSession).not.toHaveBeenCalled();
  });

  it("focuses the client slot when it materializes during the session-list load", async () => {
    const clientSessionId = "client-session:codex:materializing";
    const materializedSessionId = "runtime-session-materializing";
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-1",
    }));
    const sessionsGate = deferred<WorkspaceSession[]>();
    const ensureWorkspaceSessions = vi.fn(() => sessionsGate.promise);
    const activateSession = vi.fn();
    const { result } = renderHook(() => useSessionSelectionWorkflowActions({
      activateSession,
      ensureWorkspaceSessions,
    }));
    const guard = beginSessionActivationIntent("workspace-1");

    const selection = result.current.selectSession(materializedSessionId, { guard });
    await vi.waitFor(() => expect(ensureWorkspaceSessions).toHaveBeenCalledOnce());

    patchSessionRecord(clientSessionId, { materializedSessionId });
    sessionsGate.resolve([{
      id: materializedSessionId,
      workspaceId: "workspace-1",
      agentKind: "codex",
      modelId: "gpt-5",
      status: "idle",
      title: "Materialized session",
      lastPromptAt: null,
    } as WorkspaceSession]);

    await expect(selection).resolves.toMatchObject({
      result: "completed",
      sessionId: clientSessionId,
    });
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(clientSessionId);
    expect(getSessionRecord(clientSessionId)).toMatchObject({
      materializedSessionId,
      sessionRelationship: { kind: "root" },
      title: "Materialized session",
    });
    expect(getSessionRecord(materializedSessionId)).toBeNull();
    expect(Object.keys(useSessionDirectoryStore.getState().entriesById))
      .toEqual([clientSessionId]);
    expect(activateSession).not.toHaveBeenCalled();
  });

  it("converges a direct runtime slot when its pending client slot materializes later", async () => {
    const clientSessionId = "client-session:codex:materializing-late";
    const materializedSessionId = "runtime-session-materializing-late";
    const controlClientSessionId = "client-session:claude:control";
    const controlMaterializedSessionId = "runtime-session-control";
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-1",
    }));
    putSessionRecord(createEmptySessionRecord(controlClientSessionId, "claude", {
      materializedSessionId: controlMaterializedSessionId,
      workspaceId: "workspace-1",
    }));
    const sessionsGate = deferred<WorkspaceSession[]>();
    const ensureWorkspaceSessions = vi.fn(() => sessionsGate.promise);
    const { result } = renderHook(() => useSessionSelectionWorkflowActions({
      activateSession: vi.fn(),
      ensureWorkspaceSessions,
    }));
    const guard = beginSessionActivationIntent("workspace-1");
    const materializedSession = {
      id: materializedSessionId,
      workspaceId: "workspace-1",
      agentKind: "codex",
      modelId: "gpt-5",
      status: "idle",
      title: "Materializing session",
      lastPromptAt: null,
    } as Session;
    const controlSession = {
      id: controlMaterializedSessionId,
      workspaceId: "workspace-1",
      agentKind: "claude",
      modelId: "claude-sonnet",
      status: "idle",
      title: "Intentional second session",
      lastPromptAt: null,
    } as Session;

    const selection = result.current.selectSession(materializedSessionId, { guard });
    await vi.waitFor(() => expect(ensureWorkspaceSessions).toHaveBeenCalledOnce());
    sessionsGate.resolve([materializedSession, controlSession]);
    await expect(selection).resolves.toMatchObject({
      result: "completed",
      sessionId: materializedSessionId,
    });

    expect(Object.keys(useSessionDirectoryStore.getState().entriesById).sort()).toEqual([
      clientSessionId,
      controlClientSessionId,
      materializedSessionId,
    ].sort());
    expect(useSessionSelectionStore.getState().activeSessionId)
      .toBe(materializedSessionId);
    writeChatShellIntentForSession({
      workspaceId: "workspace-1",
      sessionId: materializedSessionId,
    });
    const workspaceUi = useWorkspaceUiStore.getState();
    workspaceUi.setShellTabOrderForWorkspace("workspace-1", [
      chatWorkspaceShellTabKey(clientSessionId),
      chatWorkspaceShellTabKey(materializedSessionId),
      chatWorkspaceShellTabKey(controlClientSessionId),
    ]);
    workspaceUi.setVisibleChatSessionIdsForWorkspace("workspace-1", [
      clientSessionId,
      materializedSessionId,
      controlClientSessionId,
    ]);
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: materializedSessionId,
      workspaceId: "workspace-1",
      configId: "reasoning_effort",
      value: "high",
    });

    publishCreatedSessionMaterialization({
      agentKind: "codex",
      fallbackModeId: null,
      fallbackModelId: "gpt-5",
      pendingSessionId: clientSessionId,
      record: {
        ...createEmptySessionRecord(clientSessionId, "codex", {
          materializedSessionId,
          workspaceId: "workspace-1",
          title: "Materializing session",
        }),
        transcriptHydrated: true,
      },
      session: materializedSession,
      trackProductEvent: vi.fn(),
      upsertWorkspaceSessionRecord: vi.fn(),
      workspaceId: "workspace-1",
      workspaceKind: "local",
    });

    const directory = useSessionDirectoryStore.getState();
    const knownTabs = buildKnownHeaderSessions({
      sessions: [materializedSession, controlSession],
      selectedWorkspaceId: "workspace-1",
      clientSessionIdByMaterializedSessionId:
        directory.clientSessionIdByMaterializedSessionId,
      liveSlots: Object.values(directory.entriesById),
    });
    expect(Object.keys(directory.entriesById).sort()).toEqual([
      clientSessionId,
      controlClientSessionId,
    ].sort());
    expect(Array.from(knownTabs.keys()).sort()).toEqual([
      clientSessionId,
      controlClientSessionId,
    ].sort());
    expect(directory.clientSessionIdByMaterializedSessionId).toMatchObject({
      [materializedSessionId]: clientSessionId,
      [controlMaterializedSessionId]: controlClientSessionId,
    });
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(clientSessionId);
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace["workspace-1"])
      .toBe(chatWorkspaceShellTabKey(clientSessionId));
    expect(useWorkspaceUiStore.getState().shellTabOrderByWorkspace["workspace-1"])
      .toEqual([
        chatWorkspaceShellTabKey(clientSessionId),
        chatWorkspaceShellTabKey(controlClientSessionId),
      ]);
    expect(useWorkspaceUiStore.getState().visibleChatSessionIdsByWorkspace["workspace-1"])
      .toEqual([clientSessionId, controlClientSessionId]);
    expect(getSessionRecord(materializedSessionId)).toBeNull();
    expect(getSessionIntentsForSession(materializedSessionId)).toEqual([]);
    expect(getSessionIntentsForSession(clientSessionId)).toEqual([
      expect.objectContaining({
        clientSessionId,
        materializedSessionId,
      }),
    ]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
