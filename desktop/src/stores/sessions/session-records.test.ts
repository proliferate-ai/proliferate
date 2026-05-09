import { createTranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import {
  createEmptySessionRecord,
  findClientSessionIdByMaterializedSessionId,
  getMaterializedSessionId,
  getSessionRecord,
  getSessionRecordByMaterializedSessionId,
  getWorkspaceSessionRecords,
  isSessionMaterialized,
  patchSessionRecord,
  putSessionRecord,
  removeSessionRecord,
  requireMaterializedSessionId,
  waitForSessionMaterialization,
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

  it("waits for materialization and rejects with the same guard error on timeout", async () => {
    vi.useFakeTimers();
    putSessionRecord(createEmptySessionRecord("client-a", "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-a",
    }));

    const pending = waitForSessionMaterialization("client-a", 1_000);
    patchSessionRecord("client-a", { materializedSessionId: "runtime-a" });
    await expect(pending).resolves.toBe("runtime-a");

    const timedOut = expect(waitForSessionMaterialization("missing-client", 1_000))
      .rejects
      .toThrow("Session is still starting. Try again in a moment.");
    await vi.advanceTimersByTimeAsync(1_000);
    await timedOut;
  });
});
