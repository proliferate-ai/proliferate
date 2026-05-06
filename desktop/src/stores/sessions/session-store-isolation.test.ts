import { createTranscriptState } from "@anyharness/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

describe("session split stores", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({
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
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("commits hot session selection and gate in one selection notification", () => {
    const listener = vi.fn();
    const unsubscribe = useSessionSelectionStore.subscribe(listener);

    useSessionSelectionStore.getState().activateHotSession({
      sessionId: "session-a",
      workspaceId: "workspace-a",
      hotPaintGate: {
        kind: "session_hot_switch",
        workspaceId: "workspace-a",
        sessionId: "session-a",
        nonce: 1,
        operationId: null,
      },
    });

    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useSessionSelectionStore.getState()).toMatchObject({
      activeSessionId: "session-a",
      activeSessionVersion: 1,
      hotPaintGate: {
        kind: "session_hot_switch",
        sessionId: "session-a",
      },
    });
  });

  it("keeps transcript writes isolated from selection and unrelated transcript entries", () => {
    useSessionTranscriptStore.getState().putEntry({
      sessionId: "session-a",
      events: [],
      transcript: createTranscriptState("session-a"),
      optimisticPrompt: null,
    });
    useSessionTranscriptStore.getState().putEntry({
      sessionId: "session-b",
      events: [],
      transcript: createTranscriptState("session-b"),
      optimisticPrompt: null,
    });
    const selectionListener = vi.fn();
    const sessionBListener = vi.fn();
    const unsubscribeSelection = useSessionSelectionStore.subscribe(selectionListener);
    const unsubscribeSessionB = useSessionTranscriptStore.subscribe((state, previous) => {
      if (state.entriesById["session-b"] !== previous.entriesById["session-b"]) {
        sessionBListener();
      }
    });

    const nextTranscript = {
      ...createTranscriptState("session-a"),
      isStreaming: true,
    };
    useSessionTranscriptStore.getState().patchEntry("session-a", {
      transcript: nextTranscript,
    });

    unsubscribeSelection();
    unsubscribeSessionB();
    expect(selectionListener).not.toHaveBeenCalled();
    expect(sessionBListener).not.toHaveBeenCalled();
    expect(useSessionTranscriptStore.getState().entriesById["session-a"]?.transcript)
      .toBe(nextTranscript);
  });

  it("preserves transcript data when patching only the optimistic prompt", () => {
    const transcript = createTranscriptState("session-a");
    const events = [{
      sessionId: "session-a",
      seq: 1,
      timestamp: "2026-04-04T00:00:01Z",
      event: { type: "turn_started" as const },
    }];
    putSessionRecord({
      ...createEmptySessionRecord("session-a", "codex", {
        workspaceId: "workspace-a",
      }),
      events,
      transcript,
    });

    patchSessionRecord("session-a", {
      optimisticPrompt: {
        seq: -1,
        promptId: "prompt-1",
        text: "Ship it",
        contentParts: [{ type: "text", text: "Ship it" }],
        queuedAt: "2026-04-04T00:00:02Z",
        promptProvenance: null,
      },
    });

    const entry = useSessionTranscriptStore.getState().entriesById["session-a"];
    expect(entry?.events).toBe(events);
    expect(entry?.transcript).toBe(transcript);
    expect(entry?.optimisticPrompt?.text).toBe("Ship it");
  });

  it("preserves workspace index references on metadata-only directory patches", () => {
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "session-a",
      workspaceId: "workspace-a",
      agentKind: "codex",
    });
    const previousIndex = useSessionDirectoryStore.getState().sessionIdsByWorkspaceId;
    const previousWorkspaceIds = previousIndex["workspace-a"];

    useSessionDirectoryStore.getState().patchEntry("session-a", {
      title: "Updated",
    });

    const nextState = useSessionDirectoryStore.getState();
    expect(nextState.sessionIdsByWorkspaceId).toBe(previousIndex);
    expect(nextState.sessionIdsByWorkspaceId["workspace-a"]).toBe(previousWorkspaceIds);
    expect(nextState.entriesById["session-a"]?.title).toBe("Updated");
  });

  it("consumes relationship hints when a directory entry is created", () => {
    useSessionDirectoryStore.getState().recordRelationshipHint("child", {
      kind: "subagent_child",
      parentSessionId: "parent",
      sessionLinkId: "link-a",
      relation: "subagent",
      workspaceId: "workspace-a",
    });

    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "child",
      workspaceId: "workspace-a",
      agentKind: "codex",
    });

    expect(useSessionDirectoryStore.getState().entriesById.child?.sessionRelationship)
      .toMatchObject({ kind: "subagent_child", parentSessionId: "parent" });
    expect(useSessionDirectoryStore.getState().relationshipHintsBySessionId.child)
      .toBeUndefined();
  });

  it("stores status-aware error attention keys in directory activity", () => {
    const transcript = createTranscriptState("session-error");
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "session-error",
      workspaceId: "workspace-a",
      agentKind: "codex",
      status: "errored",
      executionSummary: {
        phase: "errored",
        hasLiveHandle: false,
        pendingInteractions: [],
        updatedAt: "2026-04-06T00:00:00Z",
      },
    });

    useSessionDirectoryStore.getState().patchActivityFromTranscript(
      "session-error",
      transcript,
    );

    expect(
      useSessionDirectoryStore.getState().entriesById["session-error"]?.activity.errorAttentionKey,
    ).toBe("summary-terminal:session-error");
  });
});
