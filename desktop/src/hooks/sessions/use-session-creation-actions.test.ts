import { beforeEach, describe, expect, it } from "vitest";
import type {
  ModelRegistry,
  Session,
  WorkspaceSessionLaunchCatalog,
} from "@anyharness/sdk";
import {
  buildModelAvailabilityRetryOptions,
  hasImmediateLaunchModelMismatch,
  materializeSessionRecord,
  removeSessionRecordAndClearSelection,
  resolveSessionCreationModeId,
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

describe("resolveSessionCreationModeId", () => {
  it("lets an explicit mode override the stored user default", () => {
    expect(resolveSessionCreationModeId({
      explicitModeId: "bypassPermissions",
      workspaceSurface: "coding",
      agentKind: "claude",
      preferredModeId: "plan",
    })).toBe("bypassPermissions");
  });

  it("lets an explicit mode override the cowork default", () => {
    expect(resolveSessionCreationModeId({
      explicitModeId: "default",
      workspaceSurface: "cowork",
      agentKind: "claude",
      preferredModeId: "plan",
    })).toBe("default");
  });

  it("falls back to the cowork default when no explicit mode is provided", () => {
    expect(resolveSessionCreationModeId({
      workspaceSurface: "cowork",
      agentKind: "codex",
      preferredModeId: "read-only",
    })).toBe("full-access");
  });

  it("falls back to the stored user default outside cowork", () => {
    expect(resolveSessionCreationModeId({
      workspaceSurface: "coding",
      agentKind: "codex",
      preferredModeId: "auto",
    })).toBe("auto");
  });
});

const registry: ModelRegistry = {
  kind: "codex",
  displayName: "Codex",
  defaultModelId: "gpt-5.4",
  models: [
    {
      id: "gpt-5.5",
      displayName: "GPT 5.5",
      isDefault: false,
      status: "active",
      aliases: ["gpt-5.5-latest"],
      minRuntimeVersion: null,
      launchRemediation: {
        kind: "managed_reinstall",
        message: "Update Codex tools and retry.",
      },
    },
    {
      id: "gpt-5.4",
      displayName: "GPT 5.4",
      isDefault: true,
      status: "active",
      aliases: [],
      minRuntimeVersion: null,
      launchRemediation: null,
    },
  ],
};

function sessionModelPair(
  requestedModelId: string,
  modelId: string,
): Session {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    agentKind: "codex",
    requestedModelId,
    modelId,
    status: "idle",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  } as Session;
}

function launchCatalog(modelIds: string[]): WorkspaceSessionLaunchCatalog {
  return {
    workspaceId: "workspace-1",
    catalogVersion: "test",
    agents: [
      {
        kind: "codex",
        displayName: "Codex",
        defaultModelId: modelIds[0] ?? null,
        models: modelIds.map((id) => ({
          id,
          displayName: id,
          isDefault: id === modelIds[0],
        })),
      },
    ],
  };
}

describe("hasImmediateLaunchModelMismatch", () => {
  it("requires a remediable requested model that is absent from the live launch catalog", () => {
    expect(hasImmediateLaunchModelMismatch({
      session: sessionModelPair("gpt-5.5", "gpt-5.4"),
      agentKind: "codex",
      registries: [registry],
      launchCatalog: launchCatalog(["gpt-5.4"]),
    })).toBe(true);
  });

  it("does not treat live-exposed aliases as unavailable", () => {
    expect(hasImmediateLaunchModelMismatch({
      session: sessionModelPair("gpt-5.5", "gpt-5.4"),
      agentKind: "codex",
      registries: [registry],
      launchCatalog: launchCatalog(["gpt-5.5-latest"]),
    })).toBe(false);
  });

  it("does not pause for mismatches without remediation metadata", () => {
    expect(hasImmediateLaunchModelMismatch({
      session: sessionModelPair("gpt-5.4", "gpt-5.5"),
      agentKind: "codex",
      registries: [registry],
      launchCatalog: launchCatalog(["gpt-5.5"]),
    })).toBe(false);
  });
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
