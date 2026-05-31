import type { ContentPart, PromptInputBlock, Session } from "@anyharness/sdk";
import { useCallback } from "react";
import { hasPromptContent } from "@/lib/domain/chat/composer/prompt-input";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import type { PromptAttachmentSnapshot } from "@proliferate/product-domain/chats/composer/prompt-attachment-snapshot";
import { applySessionLaunchDefaults } from "@/lib/workflows/sessions/session-launch-defaults";
import { createSessionLaunchDefaultsClient } from "@/lib/access/anyharness/session-launch-defaults-client";
import {
  resolveRuntimeTargetForWorkspace,
} from "@/lib/access/anyharness/runtime-target";
import { resolveStatusFromExecutionSummary } from "@proliferate/product-domain/sessions/activity";
import {
  findCompatibleExistingSession,
  shouldProbeCompatibleRuntimeSessions,
} from "@/lib/domain/sessions/creation/compatible-session";
import {
  formatSessionCreateFailureMessage,
  toSessionCreateFailureDisplayError,
} from "@/lib/domain/sessions/creation/create-session-error";
import {
  mergeLiveDefaultLaunchControls,
  pickLiveDefaultLaunchControls,
} from "@/lib/domain/sessions/creation/launch-controls";
import { resolveSessionCreationModeId } from "@/lib/domain/sessions/creation/mode";
import { captureTelemetryException, trackProductEvent } from "@/lib/integrations/telemetry/client";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  createEmptySessionRecord,
  findClientSessionIdByMaterializedSessionId,
  getMaterializedSessionId,
  getSessionRecord,
  getSessionRecords,
  isPendingSessionId,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/derived/use-workspace-surface-lookup";
import {
  pendingConfigChangesForSessionIntents,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  sessionIntentsForSession,
} from "@proliferate/product-domain/sessions/intents/session-intent-state";
import { useSessionPromptWorkflow } from "@/hooks/sessions/workflows/use-session-prompt-workflow";
import {
  assertDirectSessionCreateRuntimeConfigStamped,
  createPendingSessionId,
  pruneInactiveSessionStreams,
  type FlushAwareSessionStreamHandle,
  type SessionStreamPruningDeps,
} from "@/lib/workflows/sessions/session-runtime";
import {
  closeSessionStreamHandle,
  flushAllSessionStreamHandles,
  getSessionStreamHandle,
} from "@/lib/access/anyharness/session-stream-handles";
import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { DESKTOP_ORIGIN } from "@/lib/domain/sessions/desktop-origin";
import {
  createSession,
  getSession,
  listWorkspaceSessions,
} from "@/lib/access/anyharness/sessions";
import type { WorkspaceShellIntentKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  rememberLastViewedSession,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { buildLatencyRequestOptions } from "@/hooks/sessions/workflows/session-creation-request-options";
import {
  materializeSessionRecord,
  removeSessionRecordAndClearSelection,
} from "@/hooks/sessions/workflows/session-creation-local-state";
import {
  inFlightSessionCreatesByWorkspace,
} from "@/hooks/sessions/workflows/session-creation-in-flight";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useCloudAgentCatalogCache } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { buildDesktopLaunchModelRegistries } from "@/lib/domain/agents/cloud-launch-catalog";
import { startCloudSessionCommandResult } from "@/lib/access/cloud/session-commands";

interface CreateSessionWithResolvedConfigOptions {
  text: string;
  blocks?: PromptInputBlock[];
  attachmentSnapshots?: PromptAttachmentSnapshot[];
  optimisticContentParts?: ContentPart[];
  agentKind: string;
  modelId: string;
  modeId?: string;
  launchControlValues?: Record<string, string>;
  workspaceId?: string;
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  promptId?: string | null;
  launchIntentId?: string | null;
  clientSessionId?: string | null;
  reuseInFlightEmptySession?: boolean;
  preferExistingCompatibleSession?: boolean;
  preserveProjectedSessionOnCreateFailure?: boolean;
  skipInitialPromptEnqueue?: boolean;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

interface CreateEmptySessionWithResolvedConfigOptions {
  agentKind: string;
  modelId: string;
  modeId?: string;
  launchControlValues?: Record<string, string>;
  workspaceId?: string;
  latencyFlowId?: string | null;
  clientSessionId?: string | null;
  reuseInFlightEmptySession?: boolean;
  preserveProjectedSessionOnCreateFailure?: boolean;
}

const sessionStreamPruningDeps: SessionStreamPruningDeps = {
  getSessionRecords,
  getSessionStreamHandle: (sessionId: string) =>
    getSessionStreamHandle(sessionId) as FlushAwareSessionStreamHandle | null,
  closeSessionStreamHandle: (
    sessionId: string,
    handle: FlushAwareSessionStreamHandle,
  ) => {
    closeSessionStreamHandle(sessionId, handle);
  },
  flushAllSessionStreamHandles,
  getMaterializedSessionId,
  findClientSessionIdByMaterializedSessionId,
  patchSessionStreamConnectionState: (
    clientSessionId: string,
    streamConnectionState,
  ) => {
    patchSessionRecord(clientSessionId, { streamConnectionState });
  },
  isPendingSessionId,
};

async function ensureRuntimeReadyForSessions(): Promise<string> {
  const state = useHarnessConnectionStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessConnectionStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}

async function resolveDesktopRuntimeUrlForWorkspace(workspaceId: string): Promise<string> {
  if (parseTargetWorkspaceSyntheticId(workspaceId) || parseCloudWorkspaceSyntheticId(workspaceId)) {
    const runtimeUrl = useHarnessConnectionStore.getState().runtimeUrl.trim();
    if (!runtimeUrl) {
      throw new Error("AnyHarness runtime URL is not available yet.");
    }
    return runtimeUrl;
  }
  return ensureRuntimeReadyForSessions();
}

export function useSessionCreationActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const { promptSession } = useSessionPromptWorkflow();
  const { activateSession } = useSessionRuntimeActions();
  const { ensureCloudAgentCatalog } = useCloudAgentCatalogCache();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const showToast = useToastStore((state) => state.show);

  const createSessionWithResolvedConfig = useCallback(async function createWithResolvedConfig(
    options: CreateSessionWithResolvedConfigOptions,
  ): Promise<string> {
    const current = useSessionSelectionStore.getState();
    const workspaceId = options.workspaceId ?? current.selectedWorkspaceId;
    if (!workspaceId) {
      throw new Error("No workspace selected");
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const hasPrompt = hasPromptContent(options.text, options.blocks)
      || (options.attachmentSnapshots?.length ?? 0) > 0;
    const promptId = hasPrompt ? options.promptId ?? createPromptId() : options.promptId ?? null;
    const shouldEnqueueInitialPrompt = hasPrompt && options.skipInitialPromptEnqueue !== true;
    const previousActiveSessionId = current.activeSessionId;
    const shouldReuseInFlightEmptySession = options.reuseInFlightEmptySession === true;
    if (!hasPrompt && shouldReuseInFlightEmptySession) {
      const inFlightCreate = inFlightSessionCreatesByWorkspace.get(workspaceId) ?? null;
      if (
        inFlightCreate
        && inFlightCreate.agentKind === options.agentKind
        && inFlightCreate.modelId === options.modelId
      ) {
        annotateLatencyFlow(options.latencyFlowId, {
          targetWorkspaceId: workspaceId,
          targetSessionId: inFlightCreate.sessionId,
        });
        const pendingShellWrite = writeChatShellIntentForSession({
          workspaceId,
          sessionId: inFlightCreate.sessionId,
        });
        if (getSessionRecord(inFlightCreate.sessionId)) {
          activateSession(inFlightCreate.sessionId);
        }
        cancelLatencyFlow(options.latencyFlowId, "session_create_reused_inflight", {
          reusedSessionId: inFlightCreate.sessionId,
          });
        try {
          const resolvedClientSessionId = await inFlightCreate.promise;
          if (pendingShellWrite) {
            activateSession(resolvedClientSessionId);
          }
          return resolvedClientSessionId;
        } catch (error) {
          let rolledBackShellIntent = false;
          if (pendingShellWrite) {
            rolledBackShellIntent = useWorkspaceUiStore.getState().rollbackShellIntent({
              workspaceId: pendingShellWrite.shellWorkspaceId,
              expectedIntent: pendingShellWrite.currentIntent,
              expectedEpoch: pendingShellWrite.epoch,
              rollbackIntent: pendingShellWrite.previousIntent,
            }).rolledBack;
          }
          if (
            rolledBackShellIntent
            && useSessionSelectionStore.getState().activeSessionId === inFlightCreate.sessionId
          ) {
            if (previousActiveSessionId) {
              activateSession(previousActiveSessionId);
            } else {
              useSessionSelectionStore.getState().setActiveSessionId(null);
            }
          }
          throw error;
        }
      }
    }

    const preferredModeId = useUserPreferencesStore.getState()
      .defaultSessionModeByAgentKind[options.agentKind]
      ?.trim() || undefined;
    const frozenDefaultLiveSessionControlValuesByAgentKind = {
      ...useUserPreferencesStore.getState().defaultLiveSessionControlValuesByAgentKind,
    };
    const explicitLiveLaunchControls = pickLiveDefaultLaunchControls(
      options.launchControlValues,
    );
    if (Object.keys(explicitLiveLaunchControls).length > 0) {
      frozenDefaultLiveSessionControlValuesByAgentKind[options.agentKind] = {
        ...(frozenDefaultLiveSessionControlValuesByAgentKind[options.agentKind] ?? {}),
        ...explicitLiveLaunchControls,
      };
    }
    const workspaceSurface = getWorkspaceSurface(workspaceId);
    const resolvedModeId = resolveSessionCreationModeId({
      explicitModeId:
        options.modeId
        ?? options.launchControlValues?.mode
        ?? options.launchControlValues?.access_mode,
      workspaceSurface,
      agentKind: options.agentKind,
      preferredModeId,
    });
    const pendingSessionId = options.clientSessionId ?? createPendingSessionId(options.agentKind);
    const existingProjectedRecord = getSessionRecord(pendingSessionId);
    annotateLatencyFlow(options.latencyFlowId, {
      targetWorkspaceId: workspaceId,
      targetSessionId: pendingSessionId,
    });

    const optimisticRecord: SessionRuntimeRecord = {
      ...createEmptySessionRecord(pendingSessionId, options.agentKind, {
        workspaceId,
        materializedSessionId: null,
        modelId: options.modelId,
        requestedModelId: options.modelId,
        modeId: resolvedModeId ?? null,
        title: existingProjectedRecord?.title ?? null,
        optimisticPrompt: null,
        pendingConfigChanges: {},
        sessionRelationship: { kind: "root" },
      }),
      status: "starting",
      transcriptHydrated: true,
    };

    putSessionRecord(optimisticRecord);
    activateSession(pendingSessionId);
    logLatency("session.create.optimistic_record", {
      clientSessionId: pendingSessionId,
      workspaceId,
      agentKind: options.agentKind,
      modelId: options.modelId,
      modeId: resolvedModeId ?? null,
      hasExistingProjectedRecord: Boolean(existingProjectedRecord),
      existingProjectedWorkspaceId: existingProjectedRecord?.workspaceId ?? null,
      hasPrompt,
      shouldEnqueueInitialPrompt,
      skipInitialPromptEnqueue: options.skipInitialPromptEnqueue === true,
      reuseInFlightEmptySession: options.reuseInFlightEmptySession ?? null,
    });
    let initialShellIntent: WorkspaceShellIntentKey | null | undefined;
    let currentOwnedShellIntent: WorkspaceShellIntentKey | null = null;
    let currentOwnedShellEpoch: number | null = null;
    let currentOwnedShellWorkspaceId: string | null = null;
    let currentOwnedSessionId: string | null = null;
    const writeOwnedShellIntent = (sessionId: string): void => {
      const write = writeChatShellIntentForSession({ workspaceId, sessionId });
      if (!write) {
        return;
      }
      if (initialShellIntent === undefined) {
        initialShellIntent = write.previousIntent;
      }
      currentOwnedShellIntent = write.currentIntent;
      currentOwnedShellEpoch = write.epoch;
      currentOwnedShellWorkspaceId = write.shellWorkspaceId;
      currentOwnedSessionId = sessionId;
    };
    const rollbackOwnedShellIntent = (): boolean => {
      if (initialShellIntent === undefined || currentOwnedShellIntent === null || currentOwnedShellEpoch === null || currentOwnedShellWorkspaceId === null) {
        return false;
      }
      return useWorkspaceUiStore.getState().rollbackShellIntent({
        workspaceId: currentOwnedShellWorkspaceId,
        expectedIntent: currentOwnedShellIntent,
        expectedEpoch: currentOwnedShellEpoch,
        rollbackIntent: initialShellIntent,
      }).rolledBack;
    };
    writeOwnedShellIntent(pendingSessionId);
    pruneInactiveSessionStreams(sessionStreamPruningDeps);
    if (shouldEnqueueInitialPrompt) {
      await promptSession({
        sessionId: pendingSessionId,
        text: options.text,
        blocks: options.blocks,
        attachmentSnapshots: options.attachmentSnapshots,
        optimisticContentParts: options.optimisticContentParts,
        workspaceId,
        latencyFlowId: options.latencyFlowId,
        measurementOperationId: options.measurementOperationId,
        promptId,
        onBeforeOptimisticPrompt: options.onBeforeOptimisticPrompt,
      });
      if (options.launchIntentId) {
        useChatLaunchIntentStore.getState()
          .markSendAttemptedIfActive(options.launchIntentId);
      }
    }

    const createPromise = (async () => {
      const requestOptions = buildLatencyRequestOptions(options.latencyFlowId);
      const runtimeUrl = await resolveDesktopRuntimeUrlForWorkspace(workspaceId);

      const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
      const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId);
      const targetConnection = {
        runtimeUrl: target.baseUrl,
        authToken: target.authToken,
      };
      const workspaceConnection = {
        ...targetConnection,
        anyharnessWorkspaceId: target.anyharnessWorkspaceId,
      };
      if (shouldProbeCompatibleRuntimeSessions({
        preferExistingCompatibleSession: options.preferExistingCompatibleSession,
        runtimeLocation: target.location,
      })) {
        const existingSession = await listWorkspaceSessions(
          workspaceConnection,
          requestOptions,
        )
          .then((sessions) => findCompatibleExistingSession({
            sessions,
            agentKind: options.agentKind,
            modelId: options.modelId,
          }))
          .catch(() => null);
        if (existingSession) {
          annotateLatencyFlow(options.latencyFlowId, {
            targetSessionId: existingSession.id,
          });
          const realRecord = materializedRecordFromExistingSession({
            clientSessionId: pendingSessionId,
            session: existingSession,
            workspaceId,
            fallbackModelId: options.modelId,
            fallbackModeId: resolvedModeId ?? null,
            fallbackTitle: existingProjectedRecord?.title ?? null,
            pendingConfigChanges: {},
          });
          materializeSessionRecord(pendingSessionId, existingSession.id, realRecord);
          useSessionIntentStore.getState().bindMaterializedSession(
            pendingSessionId,
            existingSession.id,
          );
          if (useSessionSelectionStore.getState().activeSessionId === pendingSessionId) {
            rememberLastViewedSession(workspaceId, existingSession.id);
          }
          upsertWorkspaceSessionRecord(workspaceId, existingSession);
          if (options.launchIntentId) {
            useChatLaunchIntentStore.getState().markMaterializedIfActive(
              options.launchIntentId,
              {
                clientSessionId: pendingSessionId,
                workspaceId,
                sessionId: existingSession.id,
              },
            );
          }
          return pendingSessionId;
        }
      }
      const subagentsEnabled = useUserPreferencesStore.getState().subagentsEnabled;
      let session: Session;
      if (target.location === "cloud") {
        if (!target.cloudWorkspaceId || !target.targetId) {
          throw new Error("Cloud workspace is missing command routing metadata.");
        }
        const startResult = await startCloudSessionCommandResult({
          idempotencyKey: `desktop:start-session:${target.cloudWorkspaceId}:${pendingSessionId}`,
          targetId: target.targetId,
          cloudWorkspaceId: target.cloudWorkspaceId,
          anyharnessWorkspaceId: target.anyharnessWorkspaceId,
          agentKind: options.agentKind,
          modelId: options.modelId,
          modeId: resolvedModeId ?? null,
          subagentsEnabled,
        });
        session = startResult.session
          ?? await getSession(targetConnection, startResult.sessionId, requestOptions);
      } else {
        assertDirectSessionCreateRuntimeConfigStamped(target);
        session = await createSession(targetConnection, {
          workspaceId: target.anyharnessWorkspaceId,
          agentKind: options.agentKind,
          modelId: options.modelId,
          ...(resolvedModeId ? { modeId: resolvedModeId } : {}),
          subagentsEnabled,
          origin: DESKTOP_ORIGIN,
        }, requestOptions);
      }

      annotateLatencyFlow(options.latencyFlowId, {
        targetSessionId: session.id,
      });

      const queuedConfigValuesBeforeDefaults = pendingConfigValuesForSession(pendingSessionId);
      const cloudLaunchCatalog = await ensureCloudAgentCatalog().catch(() => null);
      const modelRegistries = buildDesktopLaunchModelRegistries(
        cloudLaunchCatalog?.agents ?? [],
      );
      const liveDefaultsForLaunch = mergeLiveDefaultLaunchControls({
        defaults: frozenDefaultLiveSessionControlValuesByAgentKind,
        agentKind: options.agentKind,
        values: queuedConfigValuesBeforeDefaults,
      });
      const launchDefaults = await applySessionLaunchDefaults({
        client: createSessionLaunchDefaultsClient(targetConnection),
        session,
        agentKind: options.agentKind,
        modelRegistries,
        defaultLiveSessionControlValuesByAgentKind: liveDefaultsForLaunch,
      });
      const launchedSession = launchDefaults.session;
      const launchedLiveConfig = launchDefaults.liveConfig
        ?? launchedSession.liveConfig
        ?? null;
      const realRecord: SessionRuntimeRecord = {
        ...createEmptySessionRecord(pendingSessionId, options.agentKind, {
          workspaceId,
          materializedSessionId: launchedSession.id,
          modelId: launchedSession.modelId ?? options.modelId,
          requestedModelId: launchedSession.requestedModelId ?? options.modelId,
          modeId: launchedSession.modeId ?? resolvedModeId ?? null,
          title: launchedSession.title ?? existingProjectedRecord?.title ?? null,
          actionCapabilities: launchedSession.actionCapabilities,
          liveConfig: launchedLiveConfig,
          executionSummary: launchedSession.executionSummary ?? null,
          mcpBindingSummaries: launchedSession.mcpBindingSummaries ?? null,
          lastPromptAt: launchedSession.lastPromptAt ?? null,
          optimisticPrompt: null,
          pendingConfigChanges: {},
          sessionRelationship: { kind: "root" },
        }),
        status: resolveStatusFromExecutionSummary(
          launchedSession.executionSummary,
          launchedSession.status ?? "idle",
        ),
        transcriptHydrated: true,
      };

      materializeSessionRecord(pendingSessionId, launchedSession.id, realRecord);
      useSessionIntentStore.getState().bindMaterializedSession(
        pendingSessionId,
        launchedSession.id,
      );
      logLatency("session.create.materialized", {
        clientSessionId: pendingSessionId,
        materializedSessionId: launchedSession.id,
        workspaceId,
        agentKind: options.agentKind,
        modelId: launchedSession.modelId ?? options.modelId,
        modeId: launchedSession.modeId ?? resolvedModeId ?? null,
        status: realRecord.status,
        executionPhase: launchedSession.executionSummary?.phase ?? null,
        pendingInteractionCount: launchedSession.executionSummary?.pendingInteractions?.length ?? 0,
        activeSessionId: useSessionSelectionStore.getState().activeSessionId,
      });
      if (useSessionSelectionStore.getState().activeSessionId === pendingSessionId) {
        rememberLastViewedSession(workspaceId, launchedSession.id);
      }
      upsertWorkspaceSessionRecord(workspaceId, launchedSession);
      trackProductEvent("chat_session_created", {
        workspace_kind: cloudWorkspaceId ? "cloud" : "local",
        agent_kind: options.agentKind,
      });

      if (options.launchIntentId) {
        useChatLaunchIntentStore.getState().markMaterializedIfActive(
          options.launchIntentId,
          {
            clientSessionId: pendingSessionId,
            workspaceId,
            sessionId: launchedSession.id,
          },
        );
      }

      return pendingSessionId;
    })();

    if (!hasPrompt && shouldReuseInFlightEmptySession) {
      inFlightSessionCreatesByWorkspace.set(workspaceId, {
        sessionId: pendingSessionId,
        agentKind: options.agentKind,
        modelId: options.modelId,
        promise: createPromise,
      });
    }

    const cleanupCreateFailure = (error: unknown): void => {
      logLatency("session.create.failed", {
        clientSessionId: pendingSessionId,
        workspaceId,
        agentKind: options.agentKind,
        modelId: options.modelId,
        hasPrompt,
        hasExistingProjectedRecord: Boolean(existingProjectedRecord),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (hasPrompt) {
        markProjectedSessionPromptCreateFailed(pendingSessionId, error);
        if (options.launchIntentId) {
          useChatLaunchIntentStore.getState().clearIfActive(options.launchIntentId);
        }
        captureTelemetryException(error, {
          tags: {
            action: "create_session_with_resolved_config",
            domain: "sessions",
          },
        });
        return;
      }
      if (options.preserveProjectedSessionOnCreateFailure) {
        markProjectedSessionPromptCreateFailed(pendingSessionId, error);
        if (options.launchIntentId) {
          useChatLaunchIntentStore.getState().clearIfActive(options.launchIntentId);
        }
        captureTelemetryException(error, {
          tags: {
            action: "create_projected_session_materialization",
            domain: "sessions",
          },
        });
        return;
      }
      const activeSessionIdBeforeRemoval = useSessionSelectionStore.getState().activeSessionId;
      useSessionIntentStore.getState().clearSession(pendingSessionId);
      removeSessionRecordAndClearSelection(pendingSessionId);
      const rolledBackShellIntent = rollbackOwnedShellIntent();
      if (rolledBackShellIntent && activeSessionIdBeforeRemoval === currentOwnedSessionId) {
        if (previousActiveSessionId) {
          activateSession(previousActiveSessionId);
        } else {
          useSessionSelectionStore.getState().setActiveSessionId(null);
        }
      }
      if (options.launchIntentId) {
        useChatLaunchIntentStore.getState().clearIfActive(options.launchIntentId);
      }
      captureTelemetryException(error, {
        tags: {
          action: "create_session_with_resolved_config",
          domain: "sessions",
        },
      });
    };

    const cleanupInFlight = (): void => {
      const currentInFlight = inFlightSessionCreatesByWorkspace.get(workspaceId);
      if (currentInFlight?.promise === createPromise) {
        inFlightSessionCreatesByWorkspace.delete(workspaceId);
      }
    };

    if (hasPrompt) {
      void createPromise.catch((error) => {
        cleanupCreateFailure(error);
        showToast(formatSessionCreateFailureMessage(error), "error");
      }).finally(cleanupInFlight);
      return pendingSessionId;
    }

    try {
      return await createPromise;
    } catch (error) {
      cleanupCreateFailure(error);
      throw toSessionCreateFailureDisplayError(error);
    } finally {
      cleanupInFlight();
    }
  }, [
    activateSession,
    ensureCloudAgentCatalog,
    getWorkspaceRuntimeBlockReason,
    getWorkspaceSurface,
    promptSession,
    showToast,
    upsertWorkspaceSessionRecord,
  ]);

  const createEmptySessionWithResolvedConfig = useCallback(async (
    options: CreateEmptySessionWithResolvedConfigOptions,
  ): Promise<string> => {
    return createSessionWithResolvedConfig({
      text: "",
      agentKind: options.agentKind,
      modelId: options.modelId,
      modeId: options.modeId,
      launchControlValues: options.launchControlValues,
      workspaceId: options.workspaceId,
      latencyFlowId: options.latencyFlowId,
      clientSessionId: options.clientSessionId,
      reuseInFlightEmptySession: options.reuseInFlightEmptySession,
      preserveProjectedSessionOnCreateFailure: options.preserveProjectedSessionOnCreateFailure,
    });
  }, [createSessionWithResolvedConfig]);

  return {
    createEmptySessionWithResolvedConfig,
    createSessionWithResolvedConfig,
  };
}

function pendingConfigValuesForSession(sessionId: string): Record<string, string> {
  const pendingConfigChanges = pendingConfigChangesForSessionIntents(
    sessionIntentsForSession(useSessionIntentStore.getState(), sessionId),
  );
  return Object.fromEntries(
    Object.values(pendingConfigChanges)
      .map((change) => [change.rawConfigId, change.value] as const),
  );
}

function materializedRecordFromExistingSession({
  clientSessionId,
  session,
  workspaceId,
  fallbackModelId,
  fallbackModeId,
  fallbackTitle,
  pendingConfigChanges,
}: {
  clientSessionId: string;
  session: Session;
  workspaceId: string;
  fallbackModelId: string;
  fallbackModeId: string | null;
  fallbackTitle: string | null;
  pendingConfigChanges: SessionRuntimeRecord["pendingConfigChanges"];
}): SessionRuntimeRecord {
  return {
    ...createEmptySessionRecord(clientSessionId, session.agentKind, {
      workspaceId,
      materializedSessionId: session.id,
      modelId: session.modelId ?? fallbackModelId,
      requestedModelId: session.requestedModelId ?? fallbackModelId,
      modeId: session.modeId ?? fallbackModeId,
      title: session.title ?? fallbackTitle,
      actionCapabilities: session.actionCapabilities,
      liveConfig: session.liveConfig ?? null,
      executionSummary: session.executionSummary ?? null,
      mcpBindingSummaries: session.mcpBindingSummaries ?? null,
      lastPromptAt: session.lastPromptAt ?? null,
      optimisticPrompt: null,
      pendingConfigChanges,
      sessionRelationship: { kind: "root" },
    }),
    status: resolveStatusFromExecutionSummary(
      session.executionSummary,
      session.status ?? "idle",
    ),
    transcriptHydrated: true,
  };
}

function markProjectedSessionPromptCreateFailed(
  clientSessionId: string,
  error: unknown,
): void {
  patchSessionRecord(clientSessionId, {
    status: "errored",
  });
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : "Session creation failed.";
  const store = useSessionIntentStore.getState();
  for (const intent of Object.values(store.entriesById)) {
    if (intent.kind !== "send_prompt") {
      continue;
    }
    const entry = intent;
    if (
      entry.clientSessionId !== clientSessionId
      || entry.deliveryState === "cancelled"
      || entry.deliveryState === "echoed_tombstone"
    ) {
      continue;
    }
    store.patchIntent(entry.intentId, {
      deliveryState: "failed_before_dispatch",
      errorMessage: message,
    });
  }
}
