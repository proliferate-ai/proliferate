import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type { ContentPart, PromptInputBlock, Session, WorkspaceSessionLaunchCatalog } from "@anyharness/sdk";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { hasPromptContent } from "@/lib/domain/chat/prompt-input";
import { createPromptId } from "@/lib/domain/chat/prompt-id";
import type { PromptAttachmentSnapshot } from "@/lib/domain/chat/prompt-attachment-snapshot";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";
import { applySessionLaunchDefaults } from "@/lib/integrations/anyharness/session-launch-defaults";
import { resolveRuntimeTargetForWorkspace } from "@/lib/integrations/anyharness/runtime-target";
import { restartHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";
import { captureTelemetryException, trackProductEvent } from "@/lib/integrations/telemetry/client";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useAgentInstallationActions } from "@/hooks/agents/use-agent-installation-actions";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/use-workspace-surface-lookup";
import { useDismissedSessionCleanup } from "@/hooks/sessions/use-dismissed-session-cleanup";
import {
  requestSessionModelAvailabilityDecision,
  SessionModelAvailabilityBusyError,
  SessionModelAvailabilityCancelledError,
  SessionModelAvailabilityRoutedToSettingsError,
} from "@/hooks/sessions/use-session-model-availability-workflow";
import { reconcilePendingConfigChanges } from "@/lib/domain/sessions/pending-config";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import {
  createPendingSessionId,
  pruneInactiveSessionStreams,
} from "@/lib/integrations/anyharness/session-runtime";
import { bootstrapHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
} from "@/lib/infra/latency-flow";
import type { MeasurementOperationId } from "@/lib/infra/debug-measurement";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { DESKTOP_ORIGIN } from "@/lib/integrations/anyharness/origin";
import type { WorkspaceShellIntentKey } from "@/lib/domain/workspaces/tabs/shell-tabs";
import {
  rememberLastViewedSession,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import {
  buildLatencyRequestOptions,
  buildModelAvailabilityRetryOptions,
  buildPausedModelAvailability,
  hasImmediateLaunchModelMismatch,
  materializeSessionRecord,
  removeSessionRecordAndClearSelection,
  reportConnectorLaunchWarnings,
  resolveSessionCreationModeId,
} from "@/hooks/sessions/session-creation-helpers";
import {
  inFlightSessionCreatesByWorkspace,
} from "@/hooks/sessions/session-creation-in-flight";
import { usePromptOutboxStore } from "@/stores/chat/prompt-outbox-store";

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
  modelAvailabilityRetryCount?: number;
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
}

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

export function useSessionCreationActions() {
  const navigate = useNavigate();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const { promptSession } = useSessionPromptWorkflow();
  const { activateSession } = useSessionRuntimeActions();
  const cleanupClosedSession = useDismissedSessionCleanup();
  const {
    installAgent,
    refreshAgentResources,
  } = useAgentInstallationActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const showToast = useToastStore((state) => state.show);

  const closeCreatedMismatchSession = useCallback(async (
    client: ReturnType<typeof getAnyHarnessClient>,
    sessionId: string,
    workspaceId: string,
  ) => {
    try {
      await client.sessions.close(sessionId);
    } catch (error) {
      // Local cleanup still removes the discovery-only session from view.
      captureTelemetryException(error, {
        tags: {
          action: "close_model_mismatch_session",
          domain: "sessions",
        },
      });
    }
    cleanupClosedSession(sessionId, workspaceId);
  }, [cleanupClosedSession]);

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
        modeId: resolvedModeId ?? null,
        optimisticPrompt: null,
        pendingConfigChanges: existingProjectedRecord?.pendingConfigChanges ?? {},
        sessionRelationship: { kind: "root" },
      }),
      status: "starting",
      transcriptHydrated: true,
    };

    putSessionRecord(optimisticRecord);
    activateSession(pendingSessionId);
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
    pruneInactiveSessionStreams();
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
      const runtimeUrl = await ensureRuntimeReadyForSessions();

      const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
      const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId);
      const client = getAnyHarnessClient({
        runtimeUrl: target.baseUrl,
        authToken: target.authToken,
      });
      if (options.preferExistingCompatibleSession) {
        const existingSession = await client.sessions.list(
          target.anyharnessWorkspaceId,
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
            pendingConfigChanges: getSessionRecord(pendingSessionId)?.pendingConfigChanges ?? {},
          });
          materializeSessionRecord(pendingSessionId, existingSession.id, realRecord);
          usePromptOutboxStore.getState().bindMaterializedSession(
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
      const targetWorkspace = await client.workspaces.get(
        target.anyharnessWorkspaceId,
        requestOptions,
      ).catch(() => null);
      const pluginsInCodingSessionsEnabled = useUserPreferencesStore.getState()
        .pluginsInCodingSessionsEnabled;
      const subagentsEnabled = useUserPreferencesStore.getState().subagentsEnabled;
      const mcpLaunch = await resolveSessionMcpServersForLaunch({
        targetLocation: target.location,
        workspacePath: targetWorkspace?.path ?? null,
        launchId: crypto.randomUUID(),
        policy: {
          workspaceSurface: "coding",
          lifecycle: "create",
          enabled: pluginsInCodingSessionsEnabled,
        },
      });
      const {
        mcpServers,
        mcpBindingSummaries,
        warnings: connectorWarnings,
      } = mcpLaunch;
      const releaseRuntimeReservations = mcpLaunch.releaseRuntimeReservations ?? (async () => {});
      const session = await (async () => {
        try {
          return await client.sessions.create({
            workspaceId: target.anyharnessWorkspaceId,
            agentKind: options.agentKind,
            modelId: options.modelId,
            ...(resolvedModeId ? { modeId: resolvedModeId } : {}),
            mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
            mcpBindingSummaries: mcpBindingSummaries.length > 0
              ? mcpBindingSummaries
              : undefined,
            subagentsEnabled,
            origin: DESKTOP_ORIGIN,
          }, requestOptions);
        } finally {
          await releaseRuntimeReservations();
        }
      })();

      annotateLatencyFlow(options.latencyFlowId, {
        targetSessionId: session.id,
      });

      const modelRegistries = await client.modelRegistries.list().catch(() => []);
      const launchCatalog: WorkspaceSessionLaunchCatalog | null =
        session.requestedModelId && session.modelId
        ? await client.workspaces.getSessionLaunchCatalog(
          target.anyharnessWorkspaceId,
          requestOptions,
        ).catch(() => null)
        : null;

      if (launchCatalog && hasImmediateLaunchModelMismatch({
        session,
        agentKind: options.agentKind,
        registries: modelRegistries,
        launchCatalog,
      })) {
        const pausedLaunch = buildPausedModelAvailability({
          session,
          workspaceId,
          agentKind: options.agentKind,
          registries: modelRegistries,
        });
        const decision = await requestSessionModelAvailabilityDecision(pausedLaunch)
          .catch(async (error) => {
            if (error instanceof SessionModelAvailabilityBusyError) {
              await closeCreatedMismatchSession(client, session.id, workspaceId);
            }
            throw error;
          });

        if (decision.kind === "cancel") {
          await closeCreatedMismatchSession(client, session.id, workspaceId);
          if (options.launchIntentId) {
            useChatLaunchIntentStore.getState().clearIfActive(options.launchIntentId);
          }
          cancelLatencyFlow(options.latencyFlowId, "session_model_availability_cancelled");
          throw new SessionModelAvailabilityCancelledError();
        }

        if (decision.kind === "external_update") {
          await closeCreatedMismatchSession(client, session.id, workspaceId);
          navigate("/settings?section=agents");
          cancelLatencyFlow(
            options.latencyFlowId,
            "session_model_availability_routed_to_settings",
          );
          throw new SessionModelAvailabilityRoutedToSettingsError(
            `${pausedLaunch.requestedModelDisplayName} is not exposed by ${pausedLaunch.providerDisplayName} yet.`,
          );
        }

        if (decision.kind === "managed_reinstall") {
          if ((options.modelAvailabilityRetryCount ?? 0) >= 1) {
            await closeCreatedMismatchSession(client, session.id, workspaceId);
            throw new Error(
              `${pausedLaunch.requestedModelDisplayName} is still not exposed after updating ${pausedLaunch.providerDisplayName}.`,
            );
          }
          await closeCreatedMismatchSession(client, session.id, workspaceId);
          await installAgent(options.agentKind, { reinstall: true });
          await refreshAgentResources();
          cancelLatencyFlow(
            options.latencyFlowId,
            "session_model_availability_reinstall_retry",
          );
          return createWithResolvedConfig({
            ...buildModelAvailabilityRetryOptions({
              options,
              pendingSessionId,
              promptId,
              hasPrompt,
            }),
            modelAvailabilityRetryCount:
              (options.modelAvailabilityRetryCount ?? 0) + 1,
          });
        }

        if (decision.kind === "restart") {
          if ((options.modelAvailabilityRetryCount ?? 0) >= 1) {
            await closeCreatedMismatchSession(client, session.id, workspaceId);
            throw new Error(
              `${pausedLaunch.requestedModelDisplayName} is still not exposed after restarting ${pausedLaunch.providerDisplayName}.`,
            );
          }
          await closeCreatedMismatchSession(client, session.id, workspaceId);
          await restartHarnessRuntime();
          cancelLatencyFlow(
            options.latencyFlowId,
            "session_model_availability_restart_retry",
          );
          return createWithResolvedConfig({
            ...buildModelAvailabilityRetryOptions({
              options,
              pendingSessionId,
              promptId,
              hasPrompt,
            }),
            modelAvailabilityRetryCount:
              (options.modelAvailabilityRetryCount ?? 0) + 1,
          });
        }

        if (decision.kind === "use_current") {
          // Continue below and send the original prompt, if any, to the session
          // that already started successfully with the harness-selected model.
        }
      }

      const queuedConfigValuesBeforeDefaults = pendingConfigValuesForSession(pendingSessionId);
      const liveDefaultsForLaunch = mergeLiveDefaultLaunchControls({
        defaults: frozenDefaultLiveSessionControlValuesByAgentKind,
        agentKind: options.agentKind,
        values: queuedConfigValuesBeforeDefaults,
      });
      const launchDefaults = await applySessionLaunchDefaults({
        client,
        session,
        agentKind: options.agentKind,
        modelRegistries,
        defaultLiveSessionControlValuesByAgentKind: liveDefaultsForLaunch,
      });
      const launchedSession = launchDefaults.session;
      const launchedLiveConfig = launchDefaults.liveConfig
        ?? launchedSession.liveConfig
        ?? null;
      const latestPendingConfigChanges =
        getSessionRecord(pendingSessionId)?.pendingConfigChanges ?? {};
      const pendingConfigReconcile = reconcilePendingConfigChanges(
        launchedLiveConfig,
        latestPendingConfigChanges,
      );

      const realRecord: SessionRuntimeRecord = {
        ...createEmptySessionRecord(pendingSessionId, options.agentKind, {
          workspaceId,
          materializedSessionId: launchedSession.id,
          modelId: launchedSession.modelId ?? options.modelId,
          modeId: launchedSession.modeId ?? resolvedModeId ?? null,
          title: launchedSession.title ?? null,
          actionCapabilities: launchedSession.actionCapabilities,
          liveConfig: launchedLiveConfig,
          executionSummary: launchedSession.executionSummary ?? null,
          mcpBindingSummaries: launchedSession.mcpBindingSummaries ?? null,
          lastPromptAt: launchedSession.lastPromptAt ?? null,
          optimisticPrompt: null,
          pendingConfigChanges: pendingConfigReconcile.pendingConfigChanges,
          sessionRelationship: { kind: "root" },
        }),
        status: resolveStatusFromExecutionSummary(
          launchedSession.executionSummary,
          launchedSession.status ?? "idle",
        ),
        transcriptHydrated: true,
      };

      materializeSessionRecord(pendingSessionId, launchedSession.id, realRecord);
      usePromptOutboxStore.getState().bindMaterializedSession(
        pendingSessionId,
        launchedSession.id,
      );
      if (useSessionSelectionStore.getState().activeSessionId === pendingSessionId) {
        rememberLastViewedSession(workspaceId, launchedSession.id);
      }
      upsertWorkspaceSessionRecord(workspaceId, launchedSession);
      trackProductEvent("chat_session_created", {
        workspace_kind: cloudWorkspaceId ? "cloud" : "local",
        agent_kind: options.agentKind,
      });
      reportConnectorLaunchWarnings(connectorWarnings, showToast);

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
      const activeSessionIdBeforeRemoval = useSessionSelectionStore.getState().activeSessionId;
      usePromptOutboxStore.getState().clearSession(pendingSessionId);
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
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to start chat session: ${message}`, "error");
      }).finally(cleanupInFlight);
      return pendingSessionId;
    }

    try {
      return await createPromise;
    } catch (error) {
      cleanupCreateFailure(error);
      throw error;
    } finally {
      cleanupInFlight();
    }
  }, [
    activateSession,
    closeCreatedMismatchSession,
    getWorkspaceRuntimeBlockReason,
    getWorkspaceSurface,
    installAgent,
    navigate,
    promptSession,
    refreshAgentResources,
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
    });
  }, [createSessionWithResolvedConfig]);

  return {
    createEmptySessionWithResolvedConfig,
    createSessionWithResolvedConfig,
  };
}

function pickLiveDefaultLaunchControls(
  values: Record<string, string> | undefined,
): Partial<Record<"collaboration_mode" | "reasoning" | "effort" | "fast_mode", string>> {
  if (!values) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) =>
      (
        key === "collaboration_mode"
        || key === "reasoning"
        || key === "effort"
        || key === "fast_mode"
      )
      && value.trim().length > 0
    ),
  ) as Partial<Record<"collaboration_mode" | "reasoning" | "effort" | "fast_mode", string>>;
}

function pendingConfigValuesForSession(sessionId: string): Record<string, string> {
  const pendingConfigChanges = getSessionRecord(sessionId)?.pendingConfigChanges ?? {};
  return Object.fromEntries(
    Object.values(pendingConfigChanges)
      .map((change) => [change.rawConfigId, change.value] as const),
  );
}

function mergeLiveDefaultLaunchControls({
  defaults,
  agentKind,
  values,
}: {
  defaults: Record<string, Partial<Record<"collaboration_mode" | "reasoning" | "effort" | "fast_mode", string>>>;
  agentKind: string;
  values: Record<string, string>;
}): Record<string, Partial<Record<"collaboration_mode" | "reasoning" | "effort" | "fast_mode", string>>> {
  const liveControls = pickLiveDefaultLaunchControls(values);
  if (Object.keys(liveControls).length === 0) {
    return defaults;
  }

  return {
    ...defaults,
    [agentKind]: {
      ...(defaults[agentKind] ?? {}),
      ...liveControls,
    },
  };
}

function findCompatibleExistingSession({
  sessions,
  agentKind,
  modelId,
}: {
  sessions: readonly Session[];
  agentKind: string;
  modelId: string;
}): Session | null {
  return sessions.find((session) =>
    session.agentKind === agentKind
    && (!session.modelId || session.modelId === modelId)
  ) ?? null;
}

function materializedRecordFromExistingSession({
  clientSessionId,
  session,
  workspaceId,
  fallbackModelId,
  fallbackModeId,
  pendingConfigChanges,
}: {
  clientSessionId: string;
  session: Session;
  workspaceId: string;
  fallbackModelId: string;
  fallbackModeId: string | null;
  pendingConfigChanges: SessionRuntimeRecord["pendingConfigChanges"];
}): SessionRuntimeRecord {
  return {
    ...createEmptySessionRecord(clientSessionId, session.agentKind, {
      workspaceId,
      materializedSessionId: session.id,
      modelId: session.modelId ?? fallbackModelId,
      modeId: session.modeId ?? fallbackModeId,
      title: session.title ?? null,
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
