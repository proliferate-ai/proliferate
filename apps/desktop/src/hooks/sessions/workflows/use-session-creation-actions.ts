import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { hasPromptContent } from "@/lib/domain/chat/composer/prompt-input";
import { createPromptId } from "@/lib/domain/chat/composer/prompt-id";
import {
  formatSessionCreateFailureMessage,
  toSessionCreateFailureDisplayError,
} from "@/lib/domain/sessions/creation/create-session-error";
import { pickLiveDefaultLaunchControls } from "@/lib/domain/sessions/creation/launch-controls";
import { resolveSessionCreationModeId } from "@/lib/domain/sessions/creation/mode";
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
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { inFlightSessionCreatesByWorkspace } from "@/hooks/sessions/workflows/session-creation-in-flight";
import { useCloudAgentCatalogCache } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import type {
  CreateEmptySessionWithResolvedConfigOptions,
  CreateSessionWithResolvedConfigOptions,
} from "@/hooks/sessions/workflows/session-creation-types";
import { sessionStreamPruningDeps } from "@/hooks/sessions/workflows/session-creation-runtime";
import { materializeSessionCreation } from "@/hooks/sessions/workflows/session-creation-materialization";
import { useDismissSessionMutation } from "@anyharness/sdk-react";
import {
  beginEmptySessionReplacement,
  type EmptySessionReplacementTransaction,
} from "@/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import { registerSessionCreation } from "@/hooks/sessions/workflows/session-creation-supersession";
import {
  beginReplacementShellPreferences,
  type ReplacementShellPreferencesTransaction,
} from "@/hooks/sessions/workflows/session-replacement-shell-preferences";
import { cleanupSessionCreationFailure } from "@/hooks/sessions/workflows/session-creation-failure-cleanup";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";

export function useSessionCreationActions() {
  const host = useProductHost();
  const desktop = host.desktop;
  const cloudClient = host.cloud.client;
  const localRuntime = desktop?.runtime ?? null;
  const ssh = desktop?.ssh ?? null;
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const { promptSession } = useSessionPromptWorkflow();
  const { activateSession, closeSessionSlotStream } = useSessionRuntimeActions();
  const { ensureCloudAgentCatalog } = useCloudAgentCatalogCache();
  const { upsertWorkspaceSessionRecord, removeWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const dismissSessionMutation = useDismissSessionMutation();
  const showToast = useToastStore((state) => state.show);

  const createSessionWithResolvedConfig = useCallback(async function createWithResolvedConfig(
    options: CreateSessionWithResolvedConfigOptions,
  ): Promise<string> {
    const current = useSessionSelectionStore.getState();
    const workspaceId = options.workspaceId ?? current.selectedWorkspaceId;
    if (!workspaceId) {
      throw new Error("No workspace selected");
    }
    const recoveryWorkspaceUiKey = resolveWorkspaceUiKey(
      current.selectedLogicalWorkspaceId, workspaceId,
    ) ?? workspaceId;

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
          if (pendingShellWrite && getSessionRecord(resolvedClientSessionId)) {
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
        hasAttemptedPrompt: existingProjectedRecord?.hasAttemptedPrompt ?? false,
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

    // Stage replacement after the optimistic shell is active. The old tab is
    // hidden immediately, while destructive cleanup waits for materialization.
    let replacementTransaction: EmptySessionReplacementTransaction | null = null;
    let replacementShellPreferences: ReplacementShellPreferencesTransaction | null = null;
    if (options.replacesSessionId && !hasPrompt) {
      replacementTransaction = beginEmptySessionReplacement(
        options.replacesSessionId,
        workspaceId,
        { closeSessionSlotStream, removeWorkspaceSessionRecord, dismissSessionMutation },
      );
      if (replacementTransaction && currentOwnedShellWorkspaceId) {
        replacementShellPreferences = beginReplacementShellPreferences({
          shellWorkspaceId: currentOwnedShellWorkspaceId,
          materializedWorkspaceId: workspaceId,
          replacedSessionId: replacementTransaction.replacedSessionId,
          replacementSessionId: pendingSessionId,
        });
      }
    }

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

    const unregisterSessionCreation = registerSessionCreation(pendingSessionId);
    const createPromise = materializeSessionCreation({
      ensureCloudAgentCatalog,
      existingProjectedRecord,
      frozenDefaultLiveSessionControlValuesByAgentKind,
      localRuntime,
      cloudClient,
      ssh,
      options,
      pendingSessionId,
      resolvedModeId: resolvedModeId ?? null,
      upsertWorkspaceSessionRecord,
      workspaceId,
    }).finally(unregisterSessionCreation);

    if (!hasPrompt && shouldReuseInFlightEmptySession) {
      inFlightSessionCreatesByWorkspace.set(workspaceId, {
        sessionId: pendingSessionId,
        agentKind: options.agentKind,
        modelId: options.modelId,
        promise: createPromise,
      });
    }

    const cleanupCreateFailure = (error: unknown): void => {
      cleanupSessionCreationFailure({
        agentKind: options.agentKind,
        currentOwnedSessionId,
        error,
        hadExistingProjectedRecord: Boolean(existingProjectedRecord),
        hasPrompt,
        launchIntentId: options.launchIntentId,
        modeId: resolvedModeId ?? null,
        modelId: options.modelId,
        pendingSessionId,
        preserveProjectedSessionOnCreateFailure:
          options.preserveProjectedSessionOnCreateFailure === true,
        previousActiveSessionId,
        recoveryWorkspaceUiKey,
        replacementShellPreferences,
        replacementTransaction,
        rollbackOwnedShellIntent,
        workspaceId,
      }, { activateSession });
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
      const resolvedSessionId = await createPromise;
      const replacementOutcome = await replacementTransaction?.commit();
      if (replacementOutcome === "retained") {
        showToast(
          "Opened the new chat, but kept the previous chat because it could not be removed safely.",
          "info",
        );
      }
      return resolvedSessionId;
    } catch (error) {
      cleanupCreateFailure(error);
      throw toSessionCreateFailureDisplayError(error);
    } finally {
      cleanupInFlight();
    }
  }, [
    activateSession,
    closeSessionSlotStream,
    cloudClient,
    dismissSessionMutation,
    ensureCloudAgentCatalog,
    getWorkspaceRuntimeBlockReason,
    getWorkspaceSurface,
    localRuntime,
    ssh,
    promptSession,
    removeWorkspaceSessionRecord,
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
      replacesSessionId: options.replacesSessionId,
    });
  }, [createSessionWithResolvedConfig]);

  return { createEmptySessionWithResolvedConfig, createSessionWithResolvedConfig };
}
