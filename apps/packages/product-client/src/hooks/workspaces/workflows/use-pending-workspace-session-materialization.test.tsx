import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  usePendingWorkspaceSessionMaterialization,
  useReadyWorkspaceProjectedSessionMaterialization,
} from "#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization";

const mocks = vi.hoisted(() => ({
  createEmptySessionWithResolvedConfig: vi.fn(async (options: { clientSessionId: string }) =>
    options.clientSessionId
  ),
}));

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));

vi.mock("#product/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createEmptySessionWithResolvedConfig: mocks.createEmptySessionWithResolvedConfig,
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  isDebugMeasurementEnabled: () => false,
  logLatency: vi.fn(),
}));

describe("usePendingWorkspaceSessionMaterialization", () => {
  beforeEach(() => {
    mocks.createEmptySessionWithResolvedConfig.mockClear();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useSessionSelectionStore.setState({
      pendingWorkspaces: EMPTY_PENDING_WORKSPACE_REGISTRY,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
    });
  });

  it("remaps projected pending-workspace sessions and starts real runtime sessions", async () => {
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "feature-branch",
      request: { kind: "select-existing", workspaceId: "cloud-workspace-1" },
    });
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    putSessionRecord(createEmptySessionRecord("client-session:codex:1", "codex", {
      workspaceId: pendingWorkspaceUiKey,
      materializedSessionId: null,
      modelId: "gpt-5.5",
    }));
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: "client-session:codex:1",
      workspaceId: pendingWorkspaceUiKey,
      configId: "mode",
      value: "agent-full-access",
      persistDefaultPreference: false,
    });
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: "client-session:codex:1",
      workspaceId: pendingWorkspaceUiKey,
      configId: "collaboration_mode",
      value: "plan",
      persistDefaultPreference: false,
    });

    const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
    const materializationResult = materializePendingWorkspaceSessions(entry, "workspace-real", {
      eventPrefix: "test",
    });
    await Promise.resolve();

    expect(materializationResult).toEqual({
      pendingWorkspaceUiKey,
      projectedSessionCount: 1,
      projectedSessionIds: ["client-session:codex:1"],
    });
    expect(getSessionRecord("client-session:codex:1")?.workspaceId).toBe("workspace-real");
    // Nothing selected, so this attempt is unattended: it still materializes,
    // it just must not activate the new session or claim the visible shell.
    expect(mocks.createEmptySessionWithResolvedConfig).toHaveBeenCalledWith({
      clientSessionId: "client-session:codex:1",
      workspaceId: "workspace-real",
      agentKind: "codex",
      modelId: "gpt-5.5",
      launchControlValues: {
        mode: "agent-full-access",
        collaboration_mode: "plan",
      },
      reuseInFlightEmptySession: false,
      preserveProjectedSessionOnCreateFailure: true,
      activateOnCreate: false,
      targetWorkspaceUiKey: "workspace-real",
    });
  });

  it("activates the created session when the user is attending the attempt", async () => {
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-attended",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "feature-branch",
      request: { kind: "local", sourceRoot: "/tmp/workspace-1" },
    });
    putSessionRecord(createEmptySessionRecord("client-session:codex:2", "codex", {
      workspaceId: buildPendingWorkspaceUiKey(entry),
      materializedSessionId: null,
      modelId: "gpt-5.5",
    }));
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, entry),
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(entry),
    });

    usePendingWorkspaceSessionMaterialization()(entry, "workspace-real", { eventPrefix: "test" });
    await Promise.resolve();

    expect(mocks.createEmptySessionWithResolvedConfig).toHaveBeenCalledWith(
      expect.objectContaining({ activateOnCreate: true, targetWorkspaceUiKey: null }),
    );
  });

  it("retries projected sessions that are already attached to a ready workspace", async () => {
    putSessionRecord(createEmptySessionRecord("client-session:claude:1", "claude", {
      workspaceId: "workspace-real",
      materializedSessionId: null,
      modelId: "opus",
      hasAttemptedPrompt: true,
      sessionRelationship: { kind: "root" },
    }));
    useSessionIntentStore.getState().enqueueConfig({
      clientSessionId: "client-session:claude:1",
      workspaceId: "workspace-real",
      configId: "collaboration_mode",
      value: "default",
      persistDefaultPreference: false,
    });

    const materializeReadyWorkspaceProjectedSessions =
      useReadyWorkspaceProjectedSessionMaterialization();
    const materializationResult = materializeReadyWorkspaceProjectedSessions(
      "workspace-real",
      { eventPrefix: "test" },
    );
    await Promise.resolve();

    expect(materializationResult).toEqual({
      pendingWorkspaceUiKey: "workspace-real",
      projectedSessionCount: 1,
      projectedSessionIds: ["client-session:claude:1"],
    });
    expect(mocks.createEmptySessionWithResolvedConfig).toHaveBeenCalledWith({
      clientSessionId: "client-session:claude:1",
      workspaceId: "workspace-real",
      agentKind: "claude",
      modelId: "opus",
      launchControlValues: { collaboration_mode: "default" },
      reuseInFlightEmptySession: false,
      preserveProjectedSessionOnCreateFailure: true,
      activateOnCreate: undefined,
      targetWorkspaceUiKey: undefined,
    });
  });
});
