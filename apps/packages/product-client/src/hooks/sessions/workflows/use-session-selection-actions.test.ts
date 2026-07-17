// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
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
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
