import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { hasPromptContent } from "#product/lib/domain/chat/composer/prompt-input";
import { createPromptId } from "#product/lib/domain/chat/composer/prompt-id";
import {
  isWorkspaceDirectoryMissingError,
  toSessionCreateFailureDisplayError,
} from "#product/lib/domain/sessions/creation/create-session-error";
import { pickLiveDefaultLaunchControls } from "#product/lib/domain/sessions/creation/launch-controls";
import { isWorkspaceArchivedRefusal } from "#product/lib/domain/workspaces/archived/workspace-archived-refusal";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import {
  buildOptimisticSessionCreationRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { useSessionPromptWorkflow } from "#product/hooks/sessions/workflows/use-session-prompt-workflow";
import {
  createPendingSessionId,
  pruneInactiveSessionStreams,
} from "#product/lib/workflows/sessions/session-runtime";
import { useSessionRuntimeActions } from "#product/hooks/sessions/workflows/use-session-runtime-actions";
import { useWorkspaceSessionCache } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { annotateLatencyFlow } from "#product/lib/infra/measurement/measurement-port";
import { reuseInFlightSessionCreate } from "#product/hooks/sessions/workflows/reuse-in-flight-session-create";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import type { WorkspaceShellIntentKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { inFlightSessionCreatesByWorkspace } from "#product/hooks/sessions/workflows/session-creation-in-flight";
import type {
  CreateEmptySessionWithResolvedConfigOptions,
  CreateSessionWithResolvedConfigOptions,
} from "#product/hooks/sessions/workflows/session-creation-types";
import { sessionStreamPruningDeps } from "#product/hooks/sessions/workflows/session-creation-runtime";
import { prepareSessionCreationMaterializer } from "#product/hooks/sessions/workflows/session-creation-materialization-loader";
import { useDismissSessionMutation } from "@anyharness/sdk-react";
import {
  beginEmptySessionReplacement,
  type EmptySessionReplacementTransaction,
} from "#product/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import { registerSessionCreation } from "#product/hooks/sessions/workflows/session-creation-supersession";
import {
  beginReplacementShellPreferences,
  type ReplacementShellPreferencesTransaction,
} from "#product/hooks/sessions/workflows/session-replacement-shell-preferences";
import { adoptRecoveredSessionIdentity } from "#product/hooks/sessions/workflows/session-creation-recovered-identity";
import {
  announceQueuedPromptFailure,
  cleanupSessionCreationFailure,
} from "#product/hooks/sessions/workflows/session-creation-failure-cleanup";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useWorkspaceCollectionsInvalidationActions } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { resolveRecoveryWorkspaceUiKey } from "#product/lib/domain/workspaces/selection/workspace-ui-key";
import { useProductStorageContext } from "#product/hooks/persistence/facade/use-product-storage-context";
import type { PendingEmptySessionCreationLifecycle } from "#product/hooks/sessions/workflows/pending-empty-session-creation";
import { supportsCallerSelectedSessionCreate } from "#product/lib/access/anyharness/caller-selected-session-create";

export function useSessionCreationActions() {
  const host = useProductHost();
  const storageContext = useProductStorageContext();
  const desktop = host.desktop;
  const localRuntime = desktop?.runtime ?? null;
  const cloudClient = host.cloud.client;
  const { getWorkspaceRuntimeBlockError } = useWorkspaceRuntimeBlock();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateWorkspaceCollectionsForRuntime } = useWorkspaceCollectionsInvalidationActions();
  const { promptSession } = useSessionPromptWorkflow();
  const { activateSession, closeSessionSlotStream } = useSessionRuntimeActions();
  const { getWorkspaceSessionCacheSnapshot, removeWorkspaceSessionRecord, upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const dismissSessionMutation = useDismissSessionMutation();
  const showToast = useToastStore((state) => state.show);
  const showErrorToast = useToastStore((state) => state.showError);
  const telemetry = useProductTelemetry();
  const createSessionWithResolvedConfig = useCallback(async function createWithResolvedConfig(
    options: CreateSessionWithResolvedConfigOptions,
  ): Promise<string> {
    const current = useSessionSelectionStore.getState();
    const workspaceId = options.workspaceId ?? current.selectedWorkspaceId;
    if (!workspaceId) {
      throw new Error("No workspace selected");
    }
    const recoveryWorkspaceUiKey = resolveRecoveryWorkspaceUiKey(
      options.targetWorkspaceUiKey, current.selectedLogicalWorkspaceId, workspaceId,
    );

    const blockedError = getWorkspaceRuntimeBlockError(workspaceId);
    if (blockedError) {
      throw blockedError;
    }
    const hasPrompt = hasPromptContent(options.text, options.blocks)
      || (options.attachmentSnapshots?.length ?? 0) > 0;
    const promptId = hasPrompt ? options.promptId ?? createPromptId() : options.promptId ?? null;
    const shouldEnqueueInitialPrompt = hasPrompt && options.skipInitialPromptEnqueue !== true;
    const previousActiveSessionId = current.activeSessionId;
    const shouldReuseInFlightEmptySession = options.reuseInFlightEmptySession === true;
    if (!hasPrompt && shouldReuseInFlightEmptySession) {
      const reuse = await reuseInFlightSessionCreate({
        workspaceId,
        agentKind: options.agentKind,
        modelId: options.modelId,
        latencyFlowId: options.latencyFlowId,
        previousActiveSessionId,
      }, { activateSession });
      if (reuse.reused) {
        return reuse.clientSessionId;
      }
    }

    const preferenceState = useUserPreferencesStore.getState();
    const frozenDefaultLiveSessionControlValuesByAgentKind = options.frozenLiveControlValues
      ? { [options.agentKind]: { ...options.frozenLiveControlValues } }
      : { ...preferenceState.defaultLiveSessionControlValuesByAgentKind };
    const explicitLiveLaunchControls = pickLiveDefaultLaunchControls(
      options.launchControlValues,
    );
    if (Object.keys(explicitLiveLaunchControls).length > 0) {
      frozenDefaultLiveSessionControlValuesByAgentKind[options.agentKind] = {
        ...(frozenDefaultLiveSessionControlValuesByAgentKind[options.agentKind] ?? {}),
        ...explicitLiveLaunchControls,
      };
    }
    const selectedControlValues = {
      ...(frozenDefaultLiveSessionControlValuesByAgentKind[options.agentKind] ?? {}),
      ...(options.launchControlValues ?? {}),
    };
    const pendingSessionId = options.clientSessionId ?? createPendingSessionId(options.agentKind);
    const existingProjectedRecord = getSessionRecord(pendingSessionId);
    annotateLatencyFlow(options.latencyFlowId, {
      targetWorkspaceId: workspaceId,
      targetSessionId: pendingSessionId,
    });

    const optimisticRecord = buildOptimisticSessionCreationRecord({
      agentKind: options.agentKind,
      existingProjectedRecord,
      modelId: options.modelId,
      pendingSessionId,
      promptText: hasPrompt ? options.text : null,
      workspaceId,
    });

    putSessionRecord(optimisticRecord);
    if (options.activateOnCreate !== false) {
      activateSession(pendingSessionId);
    }
    logLatency("session.create.optimistic_record", {
      clientSessionId: pendingSessionId,
      workspaceId,
      agentKind: options.agentKind,
      modelId: options.modelId,
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
    const writeOwnedShellIntent = (sessionId: string, shellWorkspaceId?: string | null): void => {
      const write = writeChatShellIntentForSession({
        workspaceId,
        // Null falls back to the writer's own selection-derived resolution,
        // which is the key every later read resolves to.
        shellWorkspaceId: shellWorkspaceId ?? null,
        sessionId,
      });
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
        {
          closeSessionSlotStream,
          getWorkspaceSessionCacheSnapshot,
          removeWorkspaceSessionRecord,
          dismissSessionMutation,
          captureException: telemetry.captureException,
        },
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

    const cleanupCreateFailure = (error: unknown): void => {
      if (isWorkspaceDirectoryMissingError(error)) {
        // The collections cache still says the workspace is available (no
        // refetch-on-focus), so nothing would mount the missing-worktree
        // panel. Refresh availability so the panel, sidebar glyph, and send
        // gate reflect the real state.
        void invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
      }
      if (isWorkspaceArchivedRefusal(error)) {
        // The uniform WORKSPACE_ARCHIVED rule (§3.11): the server is correct,
        // only the client was stale — refresh the listing so the row moves
        // out of active lists, and raise no failure toast for this case.
        void invalidateWorkspaceCollectionsForRuntime(runtimeUrl);
      }
      cleanupSessionCreationFailure({
        agentKind: options.agentKind,
        currentOwnedSessionId,
        error,
        hadExistingProjectedRecord: Boolean(existingProjectedRecord),
        hasPrompt,
        launchIntentId: options.launchIntentId,
        controlValues: selectedControlValues,
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
      }, { activateSession, captureException: telemetry.captureException });
    };

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
          .markSendAttempted(options.launchIntentId);
      }
    }

    const unregisterSessionCreation = registerSessionCreation(pendingSessionId);
    const pendingCreationLifecycle: {
      current: PendingEmptySessionCreationLifecycle | null;
    } = { current: null };
    const setupPendingCreation = async (): Promise<void> => {
      if (!hasPrompt) {
        const workflow = await import(
          "#product/hooks/sessions/workflows/pending-empty-session-creation"
        );
        pendingCreationLifecycle.current = workflow.preparePendingEmptySessionCreation(
          storageContext,
          {
            workspaceId,
            clientSessionId: pendingSessionId,
            runtimeSessionId: options.runtimeSessionId,
            agentKind: options.agentKind,
            modelId: options.modelId,
            launchControlValues: selectedControlValues,
            frozenLiveControlValues: {
              ...(frozenDefaultLiveSessionControlValuesByAgentKind[options.agentKind] ?? {}),
            },
            subagentsEnabled: options.subagentsEnabled ?? preferenceState.subagentsEnabled,
            replacesSessionId: options.replacesSessionId,
          },
        );
        await pendingCreationLifecycle.current?.persist();
      }
    };
    const createPromise = prepareSessionCreationMaterializer(
      {
        shouldSetupPendingCreation: !hasPrompt
          && supportsCallerSelectedSessionCreate(workspaceId),
        setupPendingCreation,
      },
    ).then((materializeSessionCreation) => (
      // Executable code loads before setup begins, and the durable write then
      // resolves before materialization can reach the POST. The composed
      // promise retains the existing same-workspace in-flight reuse window.
      materializeSessionCreation({
        trackProductEvent: telemetry.track,
        captureException: telemetry.captureException,
        existingProjectedRecord,
        frozenDefaultLiveSessionControlValuesByAgentKind,
        localRuntime,
        cloudClient,
        options: pendingCreationLifecycle.current
          ? {
            ...options,
            runtimeSessionId: pendingCreationLifecycle.current.runtimeSessionId,
            subagentsEnabled: pendingCreationLifecycle.current.subagentsEnabled,
          }
          : options,
        pendingSessionId,
        upsertWorkspaceSessionRecord,
        workspaceId,
        onRuntimeSessionCreated: pendingCreationLifecycle.current
          ? () => pendingCreationLifecycle.current!.acknowledge()
          : undefined,
      })
    )).then(async (resolvedSessionId) => {
      // A superseded materializer can settle without issuing the POST. Its
      // durable intent must not be resurrected by the next bootstrap.
      await pendingCreationLifecycle.current?.clear();
      if (options.adoptMaterializedSessionId === true) {
        return adoptRecoveredSessionIdentity({
          clientSessionId: pendingSessionId,
          materializedWorkspaceId: workspaceId,
          ownedShellWorkspaceId: currentOwnedShellWorkspaceId,
          resolvedSessionId,
          writeOwnedShellIntent,
        });
      }
      return resolvedSessionId;
    }).finally(unregisterSessionCreation);

    if (!hasPrompt && shouldReuseInFlightEmptySession) {
      inFlightSessionCreatesByWorkspace.set(workspaceId, {
        sessionId: pendingSessionId,
        agentKind: options.agentKind,
        modelId: options.modelId,
        promise: createPromise,
      });
    }

    const cleanupInFlight = (): void => {
      const currentInFlight = inFlightSessionCreatesByWorkspace.get(workspaceId);
      if (currentInFlight?.promise === createPromise) {
        inFlightSessionCreatesByWorkspace.delete(workspaceId);
      }
    };

    if (hasPrompt) {
      void createPromise.catch((error) => {
        cleanupCreateFailure(error);
        announceQueuedPromptFailure(error, options.onQueuedPromptFailure, showErrorToast);
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
      await pendingCreationLifecycle.current?.clearAfterFailure(error);
      cleanupCreateFailure(error);
      throw toSessionCreateFailureDisplayError(error);
    } finally {
      cleanupInFlight();
    }
  }, [
    activateSession,
    closeSessionSlotStream,
    dismissSessionMutation,
    getWorkspaceSessionCacheSnapshot,
    getWorkspaceRuntimeBlockError,
    invalidateWorkspaceCollectionsForRuntime,
    runtimeUrl,
    localRuntime,
    cloudClient,
    promptSession,
    removeWorkspaceSessionRecord,
    showErrorToast,
    showToast,
    telemetry,
    upsertWorkspaceSessionRecord,
    storageContext,
  ]);

  const createEmptySessionWithResolvedConfig = useCallback((
    options: CreateEmptySessionWithResolvedConfigOptions,
  ): Promise<string> => createSessionWithResolvedConfig({ ...options, text: "" }), [
    createSessionWithResolvedConfig,
  ]);

  return { createEmptySessionWithResolvedConfig, createSessionWithResolvedConfig };
}
