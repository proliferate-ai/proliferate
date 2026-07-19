import { beforeEach, describe, expect, it } from "vitest";
import { buildModelAvailabilityRetryOptions } from "#product/lib/domain/sessions/creation/retry-options";
import {
  materializeSessionRecord,
  promoteMaterializedSessionIdentity,
  removeSessionRecordAndClearSelection,
} from "#product/hooks/sessions/workflows/session-creation-local-state";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import {
  getSessionIntentsForSession,
  useSessionIntentStore,
} from "#product/stores/sessions/session-intent-store";

beforeEach(() => {
  useSessionSelectionStore.getState().clearSelection();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
});

describe("projected session materialization", () => {
  it("keeps the client id active and patches the materialized id into the same record", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "workspace-1",
      workspaceId: "workspace-1",
    });
    putSessionRecord(
      createEmptySessionRecord("pending-codex", "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: null,
      }),
    );
    useSessionSelectionStore.getState().setActiveSessionId("pending-codex");
    const versionBefore = useSessionSelectionStore.getState().activeSessionVersion;

    materializeSessionRecord(
      "pending-codex",
      "session-1",
      createEmptySessionRecord("pending-codex", "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: "session-1",
      }),
    );

    expect(useSessionSelectionStore.getState().activeSessionId).toBe("pending-codex");
    expect(getSessionRecord("pending-codex")?.materializedSessionId).toBe("session-1");
    expect(useSessionDirectoryStore.getState().clientSessionIdByMaterializedSessionId["session-1"])
      .toBe("pending-codex");
    expect(getSessionRecord("session-1")).toBeNull();
    expect(useSessionSelectionStore.getState().activeSessionVersion).toBe(versionBefore);
  });

  it("clears active session when removing an active pending slot", () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "workspace-1",
      workspaceId: "workspace-1",
    });
    putSessionRecord(
      createEmptySessionRecord("pending-codex", "codex", {
        workspaceId: "workspace-1",
      }),
    );
    useSessionSelectionStore.getState().setActiveSessionId("pending-codex");
    const versionBefore = useSessionSelectionStore.getState().activeSessionVersion;

    removeSessionRecordAndClearSelection("pending-codex");

    expect(useSessionSelectionStore.getState().activeSessionId).toBeNull();
    expect(getSessionRecord("pending-codex")).toBeNull();
    expect(useSessionSelectionStore.getState().activeSessionVersion).toBe(versionBefore + 1);
  });

  it("promotes a recovered shell and its queued work to the authoritative runtime id", () => {
    const clientSessionId = "client-session:codex:recovered";
    const runtimeSessionId = "01234567-89ab-4def-8123-456789abcdef";
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "workspace-1",
      workspaceId: "workspace-1",
    });
    putSessionRecord(
      createEmptySessionRecord(clientSessionId, "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: null,
      }),
    );
    useSessionSelectionStore.getState().setActiveSessionId(clientSessionId);
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId,
      workspaceId: "workspace-1",
      configId: "reasoning_effort",
      value: "high",
    });

    materializeSessionRecord(
      clientSessionId,
      runtimeSessionId,
      createEmptySessionRecord(clientSessionId, "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: runtimeSessionId,
      }),
    );
    useSessionIntentStore.getState().bindMaterializedSession(
      clientSessionId,
      runtimeSessionId,
    );

    expect(promoteMaterializedSessionIdentity(clientSessionId)).toBe(runtimeSessionId);
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(runtimeSessionId);
    expect(getSessionRecord(clientSessionId)).toBeNull();
    expect(getSessionRecord(runtimeSessionId)).toMatchObject({
      sessionId: runtimeSessionId,
      materializedSessionId: runtimeSessionId,
      transcript: {
        sessionMeta: { sessionId: runtimeSessionId },
      },
    });
    expect(
      useSessionDirectoryStore.getState()
        .clientSessionIdByMaterializedSessionId[runtimeSessionId],
    ).toBe(runtimeSessionId);
    expect(getSessionIntentsForSession(clientSessionId)).toEqual([]);
    expect(getSessionIntentsForSession(runtimeSessionId)).toEqual([
      expect.objectContaining({
        clientSessionId: runtimeSessionId,
        materializedSessionId: runtimeSessionId,
        kind: "update_config",
      }),
    ]);
  });

  it("preserves an already loaded authoritative runtime record during promotion", () => {
    const clientSessionId = "client-session:codex:collision";
    const runtimeSessionId = "11234567-89ab-4def-8123-456789abcdef";
    putSessionRecord(
      createEmptySessionRecord(clientSessionId, "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: null,
        title: "Recovered replay snapshot",
      }),
    );
    materializeSessionRecord(
      clientSessionId,
      runtimeSessionId,
      createEmptySessionRecord(clientSessionId, "codex", {
        workspaceId: "workspace-1",
        materializedSessionId: runtimeSessionId,
        title: "Recovered replay snapshot",
      }),
    );
    const authoritativeRecord = createEmptySessionRecord(runtimeSessionId, "codex", {
      workspaceId: "workspace-1",
      materializedSessionId: runtimeSessionId,
      title: "Authoritative runtime state",
    });
    const authoritativeTranscript = {
      ...authoritativeRecord.transcript,
      sessionMeta: {
        ...authoritativeRecord.transcript.sessionMeta,
        title: "Authoritative transcript",
      },
    };
    putSessionRecord({
      ...authoritativeRecord,
      transcript: authoritativeTranscript,
      transcriptHydrated: true,
    });
    useSessionSelectionStore.getState().setActiveSessionId(clientSessionId);
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId,
      workspaceId: "workspace-1",
      configId: "reasoning_effort",
      value: "high",
    });
    useSessionIntentStore.getState().bindMaterializedSession(
      clientSessionId,
      runtimeSessionId,
    );

    expect(promoteMaterializedSessionIdentity(clientSessionId)).toBe(runtimeSessionId);

    const promoted = getSessionRecord(runtimeSessionId);
    expect(promoted?.title).toBe("Authoritative runtime state");
    expect(promoted?.transcript).toBe(authoritativeTranscript);
    expect(promoted?.transcriptHydrated).toBe(true);
    expect(getSessionRecord(clientSessionId)).toBeNull();
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(runtimeSessionId);
    expect(getSessionIntentsForSession(clientSessionId)).toEqual([]);
    expect(getSessionIntentsForSession(runtimeSessionId)).toEqual([
      expect.objectContaining({
        clientSessionId: runtimeSessionId,
        materializedSessionId: runtimeSessionId,
      }),
    ]);
    expect(
      useSessionDirectoryStore.getState()
        .clientSessionIdByMaterializedSessionId[runtimeSessionId],
    ).toBe(runtimeSessionId);
  });
});

describe("buildModelAvailabilityRetryOptions", () => {
  it("retries prompt creates against the same projected session without re-enqueueing", () => {
    const retry = buildModelAvailabilityRetryOptions({
      pendingSessionId: "client-session:codex:1",
      promptId: "prompt-1",
      hasPrompt: true,
      options: {
        text: "hello",
        blocks: [{ type: "text", text: "hello" }],
        optimisticContentParts: [{ type: "text", text: "hello" }],
        agentKind: "codex",
        modelId: "gpt-5.5",
        workspaceId: "workspace-1",
        latencyFlowId: "flow-1",
        measurementOperationId: "mop_1",
        promptId: "prompt-1",
      },
    });

    expect(retry.clientSessionId).toBe("client-session:codex:1");
    expect(retry.promptId).toBe("prompt-1");
    expect(retry.skipInitialPromptEnqueue).toBe(true);
    expect(retry.reuseInFlightEmptySession).toBe(false);
    expect(retry.latencyFlowId).toBeNull();
    expect(retry.measurementOperationId).toBeNull();
  });

  it("does not suppress enqueue semantics for empty-session retries", () => {
    const retry = buildModelAvailabilityRetryOptions({
      pendingSessionId: "client-session:codex:1",
      promptId: null,
      hasPrompt: false,
      options: {
        text: "",
        agentKind: "codex",
        modelId: "gpt-5.5",
        workspaceId: "workspace-1",
      },
    });

    expect(retry.clientSessionId).toBe("client-session:codex:1");
    expect(retry.promptId).toBeNull();
    expect(retry.skipInitialPromptEnqueue).toBe(false);
    expect(retry.reuseInFlightEmptySession).toBe(false);
  });
});
