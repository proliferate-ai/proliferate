import { createTranscriptState, type PendingInteraction } from "@anyharness/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activitySnapshotFromDirectoryEntry } from "@/lib/domain/sessions/directory/directory-activity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

describe("session directory store invariants", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
  });

  it("keeps materialized and workspace indexes consistent across patches and removals", () => {
    const store = useSessionDirectoryStore.getState();
    store.upsertEntry({
      sessionId: "client-a",
      materializedSessionId: null,
      workspaceId: "workspace-a",
      agentKind: "codex",
    });
    store.upsertEntry({
      sessionId: "client-b",
      materializedSessionId: "runtime-b",
      workspaceId: "workspace-a",
      agentKind: "codex",
    });

    store.patchEntry("client-a", { materializedSessionId: "runtime-a" });
    store.patchEntry("client-a", {
      materializedSessionId: "runtime-a-2",
      workspaceId: "workspace-b",
    });
    store.removeEntry("client-b");

    expect(useSessionDirectoryStore.getState().clientSessionIdByMaterializedSessionId)
      .toEqual({ "runtime-a-2": "client-a" });
    expect(useSessionDirectoryStore.getState().sessionIdsByWorkspaceId)
      .toEqual({ "workspace-b": ["client-a"] });
  });

  it("does not notify or replace indexed references for equal directory writes", () => {
    const store = useSessionDirectoryStore.getState();
    store.upsertEntry({
      sessionId: "session-a",
      materializedSessionId: "runtime-a",
      workspaceId: "workspace-a",
      agentKind: "codex",
      title: "Working title",
    });
    const listener = vi.fn();
    const before = useSessionDirectoryStore.getState();
    const unsubscribe = useSessionDirectoryStore.subscribe(listener);

    store.patchEntry("session-a", { title: "Working title" });

    unsubscribe();
    const after = useSessionDirectoryStore.getState();
    expect(listener).not.toHaveBeenCalled();
    expect(after).toBe(before);
    expect(after.entriesById).toBe(before.entriesById);
    expect(after.clientSessionIdByMaterializedSessionId)
      .toBe(before.clientSessionIdByMaterializedSessionId);
    expect(after.sessionIdsByWorkspaceId).toBe(before.sessionIdsByWorkspaceId);
  });

  it("applies relationship hints once and prunes stale workspace hints", () => {
    const store = useSessionDirectoryStore.getState();
    store.recordRelationshipHint("child-a", {
      kind: "subagent_child",
      parentSessionId: "parent-a",
      sessionLinkId: "link-a",
      relation: "subagent",
      workspaceId: "workspace-a",
    });
    store.recordRelationshipHint("missing-child", {
      kind: "linked_child",
      parentSessionId: "parent-b",
      workspaceId: "workspace-a",
    });

    store.upsertEntry({
      sessionId: "child-a",
      workspaceId: "workspace-a",
      agentKind: "codex",
    });
    store.removeWorkspaceEntries("workspace-a");
    store.upsertEntry({
      sessionId: "child-a",
      workspaceId: "workspace-b",
      agentKind: "codex",
    });

    const state = useSessionDirectoryStore.getState();
    expect(state.relationshipHintsBySessionId).toEqual({});
    expect(state.entriesById["child-a"]?.sessionRelationship).toEqual({ kind: "pending" });
  });

  it("updates activity from transcript while preserving unrelated directory fields", () => {
    const pendingInteractions: PendingInteraction[] = [{
      requestId: "request-a",
      toolCallId: "tool-a",
      toolKind: "exec",
      toolStatus: null,
      linkedPlanId: null,
      title: "Approve",
      description: null,
      kind: "permission",
      options: [],
    }];
    const transcript = {
      ...createTranscriptState("session-a"),
      currentModeId: "plan",
      isStreaming: true,
      pendingInteractions,
      sessionMeta: {
        ...createTranscriptState("session-a").sessionMeta,
        title: "Transcript title",
      },
    };
    const store = useSessionDirectoryStore.getState();
    store.upsertEntry({
      sessionId: "session-a",
      workspaceId: "workspace-a",
      agentKind: "codex",
      modelId: "model-a",
      title: null,
    });

    store.patchActivityFromTranscript("session-a", transcript);

    const entry = useSessionDirectoryStore.getState().entriesById["session-a"];
    expect(entry).toMatchObject({
      modelId: "model-a",
      modeId: "plan",
      title: "Transcript title",
      activity: {
        isStreaming: true,
        pendingInteractions,
        transcriptTitle: "Transcript title",
      },
    });
    expect(activitySnapshotFromDirectoryEntry(entry)).toEqual({
      status: null,
      executionSummary: null,
      streamConnectionState: "disconnected",
      transcript: {
        isStreaming: true,
        pendingInteractions,
      },
    });
  });
});
