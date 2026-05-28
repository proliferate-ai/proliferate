import { createTranscriptState, type Session } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionSlotPatchFromSummary } from "@/lib/domain/sessions/summary";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import {
  createEmptySessionRecord,
  createSessionRecordFromSummary,
  findClientSessionIdByMaterializedSessionId,
  getMaterializedSessionId,
  getSessionRecord,
  getSessionRecordByMaterializedSessionId,
  getWorkspaceSessionRecords,
  isPendingSessionId,
  isSessionMaterialized,
  patchSessionRecord,
  putSessionRecord,
  removeSessionRecord,
  requireMaterializedSessionId,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

describe("session records facade invariants", () => {
  beforeEach(() => {
    vi.useRealTimers();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIngestStore.getState().clear();
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: null,
      selectedLogicalWorkspaceId: "workspace-stable",
      selectedWorkspaceId: "workspace-stable",
      workspaceSelectionNonce: 7,
      workspaceArrivalEvent: null,
      activeSessionId: "session-stable",
      activeSessionVersion: 3,
      sessionActivationIntentEpochByWorkspace: { "workspace-stable": 2 },
      hotPaintGate: null,
      _hydrated: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("materializes pending client records without replacing transcript state", () => {
    const transcript = createTranscriptState("client-a");
    putSessionRecord({
      ...createEmptySessionRecord("client-a", "codex", {
        materializedSessionId: null,
        workspaceId: "workspace-a",
      }),
      transcript,
    });

    patchSessionRecord("client-a", { materializedSessionId: "runtime-a" });

    expect(getMaterializedSessionId("client-a")).toBe("runtime-a");
    expect(requireMaterializedSessionId("client-a")).toBe("runtime-a");
    expect(isSessionMaterialized("client-a")).toBe(true);
    expect(findClientSessionIdByMaterializedSessionId("runtime-a")).toBe("client-a");
    expect(getSessionRecordByMaterializedSessionId("runtime-a")?.sessionId).toBe("client-a");
    expect(getSessionRecord("client-a")?.transcript).toBe(transcript);
  });

  it("classifies pending client ids from synchronous directory state", () => {
    putSessionRecord(createEmptySessionRecord("client-a", "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-a",
    }));
    putSessionRecord(createEmptySessionRecord("session-a", "codex", {
      workspaceId: "workspace-a",
    }));

    expect(isPendingSessionId("client-a")).toBe(true);
    expect(isPendingSessionId("session-a")).toBe(false);

    patchSessionRecord("client-a", { materializedSessionId: "runtime-a" });

    expect(isPendingSessionId("client-a")).toBe(false);
  });

  it("returns only complete records from workspace-indexed facade reads", () => {
    putSessionRecord(createEmptySessionRecord("session-a", "codex", {
      workspaceId: "workspace-a",
    }));
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: "directory-only",
      workspaceId: "workspace-a",
      agentKind: "codex",
    });
    useSessionTranscriptStore.getState().putEntry({
      sessionId: "transcript-only",
      events: [],
      transcript: createTranscriptState("transcript-only"),
      optimisticPrompt: null,
    });

    expect(Object.keys(getWorkspaceSessionRecords("workspace-a"))).toEqual(["session-a"]);
    expect(getSessionRecord("directory-only")).toBeNull();
    expect(getWorkspaceSessionRecords(null)).toEqual({});
  });

  it("removes records from directory, transcript, and materialized lookup state together", () => {
    putSessionRecord(createEmptySessionRecord("session-a", "codex", {
      materializedSessionId: "runtime-a",
      workspaceId: "workspace-a",
    }));

    removeSessionRecord("session-a");

    expect(getSessionRecord("session-a")).toBeNull();
    expect(findClientSessionIdByMaterializedSessionId("runtime-a")).toBeNull();
    expect(useSessionDirectoryStore.getState().entriesById).toEqual({});
    expect(useSessionTranscriptStore.getState().entriesById).toEqual({});
  });

  it("does not mutate selection or ingest stores when writing local records", () => {
    useSessionIngestStore.getState().setHotTargets([{
      clientSessionId: "hot-a",
      materializedSessionId: "hot-a",
      workspaceId: "workspace-stable",
      priority: 0,
      reason: "selected",
      streamable: true,
    }]);
    const selectionBefore = useSessionSelectionStore.getState();
    const ingestBefore = useSessionIngestStore.getState();

    putSessionRecord(createEmptySessionRecord("session-a", "codex", {
      workspaceId: "workspace-a",
    }));
    patchSessionRecord("session-a", { title: "Updated title" });

    expect(useSessionSelectionStore.getState()).toBe(selectionBefore);
    expect(useSessionIngestStore.getState()).toBe(ingestBefore);
  });

  it("initializes empty pending config changes and pending relationships on new records", () => {
    const record = createEmptySessionRecord("session-1", "codex");

    expect(record.pendingConfigChanges).toEqual({});
    expect(record.sessionRelationship).toEqual({ kind: "pending" });
  });

  it("applies and prunes relationship hints when records mount later", () => {
    useSessionDirectoryStore.getState().recordRelationshipHint("child-session", {
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-1",
    });

    putSessionRecord(
      createEmptySessionRecord("child-session", "codex", {
        workspaceId: "workspace-1",
      }),
    );

    expect(useSessionDirectoryStore.getState().entriesById["child-session"]?.sessionRelationship)
      .toEqual({
        kind: "subagent_child",
        parentSessionId: "parent-session",
        sessionLinkId: "link-1",
        relation: "subagent",
        workspaceId: "workspace-1",
      });
    expect(useSessionDirectoryStore.getState().relationshipHintsBySessionId["child-session"])
      .toBeUndefined();
  });

  it("uses the subagent label as a fallback title for untitled runtime-created sessions", () => {
    const session = {
      id: "child-session",
      agentKind: "claude",
      modelId: "opus",
      modeId: "default",
      title: null,
      status: "idle",
      liveConfig: null,
      executionSummary: null,
      mcpBindingSummaries: null,
      lastPromptAt: null,
    } as Session;

    const record = createSessionRecordFromSummary(session, "workspace-1", {
      titleFallback: "haiku-test",
    });

    expect(record.sessionId).toBe("child-session");
    expect(record.workspaceId).toBe("workspace-1");
    expect(record.title).toBe("haiku-test");
    expect(record.transcript.sessionMeta.title).toBe("haiku-test");
    expect(record.transcriptHydrated).toBe(false);
    expect(record.status).toBe("idle");
  });

  it("preserves requested model ids from runtime summaries", () => {
    const record = createSessionRecordFromSummary(
      {
        id: "session-1",
        agentKind: "claude",
        modelId: "sonnet",
        requestedModelId: "us.anthropic.claude-opus-4-7",
        modeId: "default",
        title: "Claude session",
        status: "idle",
        liveConfig: null,
        executionSummary: null,
        mcpBindingSummaries: null,
        lastPromptAt: null,
      } as Session,
      "workspace-1",
    );

    expect(record.modelId).toBe("sonnet");
    expect(record.requestedModelId).toBe("us.anthropic.claude-opus-4-7");
  });

  it("preserves existing relationship metadata across summary patches", () => {
    const relationship = {
      kind: "review_child" as const,
      parentSessionId: "parent-session",
      sessionLinkId: "review-link-1",
      relation: "review",
      workspaceId: "workspace-1",
    };
    const record = createEmptySessionRecord("review-session", "codex", {
      workspaceId: "workspace-1",
      sessionRelationship: relationship,
    });
    putSessionRecord(record);

    const patch = buildSessionSlotPatchFromSummary(
      {
        id: "review-session",
        agentKind: "codex",
        modelId: "gpt-5.4",
        modeId: "default",
        title: "Reviewer",
        status: "idle",
        liveConfig: null,
        executionSummary: null,
        mcpBindingSummaries: null,
        lastPromptAt: null,
      } as Session,
      "workspace-1",
      record.transcript,
    );
    patchSessionRecord("review-session", patch);

    expect(useSessionDirectoryStore.getState().entriesById["review-session"]?.sessionRelationship)
      .toEqual(relationship);
  });
});
