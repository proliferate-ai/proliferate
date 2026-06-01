import { useCallback } from "react";
import { hasPromptContent } from "@/lib/domain/chat/composer/prompt-input";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import {
  formatSessionCreateFailureMessage,
  toSessionCreateFailureDisplayError,
} from "@/lib/domain/sessions/creation/create-session-error";
import {
  pickLiveDefaultLaunchControls,
} from "@/lib/domain/sessions/creation/launch-controls";
import { resolveSessionCreationModeId } from "@/lib/domain/sessions/creation/mode";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/derived/use-workspace-surface-lookup";
import { useSessionPromptWorkflow } from "@/hooks/sessions/workflows/use-session-prompt-workflow";
import {
  createPendingSessionId,
  pruneInactiveSessionStreams,
} from "@/lib/workflows/sessions/session-runtime";
import { useSessionRuntimeActions } from "@/hooks/sessions/workflows/use-session-runtime-actions";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import type { WorkspaceShellIntentKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import {
  removeSessionRecordAndClearSelection,
} from "@/hooks/sessions/workflows/session-creation-local-state";
import {
  inFlightSessionCreatesByWorkspace,
} from "@/hooks/sessions/workflows/session-creation-in-flight";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useCloudAgentCatalogCache } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import type {
  CreateEmptySessionWithResolvedConfigOptions,
  CreateSessionWithResolvedConfigOptions,
} from "@/hooks/sessions/workflows/session-creation-types";
import {
  sessionStreamPruningDeps,
} from "@/hooks/sessions/workflows/session-creation-runtime";
import {
  markProjectedSessionPromptCreateFailed,
} from "@/hooks/sessions/workflows/session-creation-failure";
import {
  materializeSessionCreation,
} from "@/hooks/sessions/workflows/session-creation-materialization";

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

    const createPromise = materializeSessionCreation({
      ensureCloudAgentCatalog,
      existingProjectedRecord,
      frozenDefaultLiveSessionControlValuesByAgentKind,
      options,
      pendingSessionId,
      resolvedModeId: resolvedModeId ?? null,
      upsertWorkspaceSessionRecord,
      workspaceId,
    });

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
