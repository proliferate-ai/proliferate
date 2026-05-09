import { beforeEach, describe, expect, it } from "vitest";
import {
  buildModelAvailabilityRetryOptions,
  materializeSessionRecord,
  removeSessionRecordAndClearSelection,
} from "@/hooks/sessions/session-creation-helpers";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";

beforeEach(() => {
  useSessionSelectionStore.getState().clearSelection();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
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
