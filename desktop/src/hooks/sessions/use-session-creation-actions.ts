import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type {
  ContentPart,
  PromptInputBlock,
  WorkspaceSessionLaunchCatalog,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { hasPromptContent } from "@/lib/domain/chat/prompt-input";
import { getCloudWorkspace } from "@/lib/integrations/cloud/workspaces";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";
import { resolveRuntimeTargetForWorkspace } from "@/lib/integrations/anyharness/runtime-target";
import { restartHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { buildFirstSessionBranchNamingPrompt } from "@/lib/domain/workspaces/branch-naming";
import { useAgentInstallationActions } from "@/hooks/agents/use-agent-installation-actions";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  type SessionSlot,
  useHarnessStore,
} from "@/stores/sessions/harness-store";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useBranchRenameStore } from "@/stores/workspaces/branch-rename-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/use-workspace-surface-lookup";
import { useDismissedSessionCleanup } from "@/hooks/sessions/use-dismissed-session-cleanup";
import {
  requestSessionModelAvailabilityDecision,
  SessionModelAvailabilityBusyError,
  SessionModelAvailabilityCancelledError,
  SessionModelAvailabilityRoutedToSettingsError,
} from "@/hooks/sessions/use-session-model-availability-workflow";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import {
  createEmptySessionSlot,
  createPendingSessionId,
  getSessionClientAndWorkspace,
  pruneInactiveSessionStreams,
} from "@/lib/integrations/anyharness/session-runtime";
import { bootstrapHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import type { WorkspaceSession } from "@/hooks/sessions/use-session-selection-actions";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
} from "@/lib/infra/latency-flow";
import { DESKTOP_ORIGIN } from "@/lib/integrations/anyharness/origin";
import {
  beginPendingBranchRenameTracking,
  buildLatencyRequestOptions,
  buildPausedModelAvailability,
  hasImmediateLaunchModelMismatch,
  removeSessionSlot,
  replacePendingSessionSlot,
  reportConnectorLaunchWarnings,
  resolveSessionCreationModeId,
} from "@/hooks/sessions/session-creation-helpers";

interface SessionCreationDeps {
  ensureWorkspaceSessions: (workspaceId: string) => Promise<WorkspaceSession[]>;
}

interface InFlightSessionCreate {
  sessionId: string;
  agentKind: string;
  modelId: string;
  promise: Promise<string>;
}

const inFlightSessionCreatesByWorkspace = new Map<string, InFlightSessionCreate>();

interface CreateSessionWithResolvedConfigOptions {
  text: string;
  blocks?: PromptInputBlock[];
  optimisticContentParts?: ContentPart[];
  agentKind: string;
  modelId: string;
  modeId?: string;
  workspaceId?: string;
  latencyFlowId?: string | null;
  promptId?: string | null;
  launchIntentId?: string | null;
  reuseInFlightEmptySession?: boolean;
  modelAvailabilityRetryCount?: number;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
}

interface CreateEmptySessionWithResolvedConfigOptions {
  agentKind: string;
  modelId: string;
  modeId?: string;
  workspaceId?: string;
  latencyFlowId?: string | null;
  reuseInFlightEmptySession?: boolean;
}

async function ensureRuntimeReadyForSessions(): Promise<string> {
  const state = useHarnessStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}

function updateInFlightSessionCreateId(
  workspaceId: string,
  previousSessionId: string,
  nextSessionId: string,
): void {
  const inFlightCreate = inFlightSessionCreatesByWorkspace.get(workspaceId);
  if (!inFlightCreate || inFlightCreate.sessionId !== previousSessionId) {
    return;
  }

  inFlightSessionCreatesByWorkspace.set(workspaceId, {
    ...inFlightCreate,
    sessionId: nextSessionId,
  });
}

export function useSessionCreationActions({
  ensureWorkspaceSessions,
}: SessionCreationDeps) {
  const navigate = useNavigate();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const { promptSession } = useSessionPromptWorkflow();
  const { activateSession, ensureSessionStreamConnected } = useSessionRuntimeActions();
  const cleanupClosedSession = useDismissedSessionCleanup();
  const {
    installAgent,
    refreshAgentResources,
  } = useAgentInstallationActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const showToast = useToastStore((state) => state.show);

  const maybeStartFirstSessionBranchRenameTracking = useCallback(async (
    sessionId: string,
    workspaceId: string,
  ) => {
    if (useBranchRenameStore.getState().pendingByWorkspaceId[workspaceId]) {
      return;
    }

    const slot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
    if (slot && slot.events.length > 0) {
      return;
    }

    const sessions = await ensureWorkspaceSessions(workspaceId).catch(() => []);
    if (sessions.length !== 1 || sessions[0]?.id !== sessionId) {
      return;
    }

    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
    const { connection, target } = await getSessionClientAndWorkspace(sessionId);
    const workspace = await getAnyHarnessClient(connection).workspaces.get(
      target.anyharnessWorkspaceId,
    ).catch(() => null);
    const placeholderBranch = workspace?.originalBranch?.trim()
      || workspace?.currentBranch?.trim()
      || null;
    const currentBranch = workspace?.currentBranch?.trim() || placeholderBranch;
    const isBranchBackedWorkspace =
      cloudWorkspaceId !== null || workspace?.kind === "worktree";
    if (!isBranchBackedWorkspace || !placeholderBranch || currentBranch !== placeholderBranch) {
      return;
    }

    beginPendingBranchRenameTracking({
      workspaceId,
      placeholderBranch,
      cloudWorkspaceId,
    });
  }, [ensureWorkspaceSessions]);

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
    const current = useHarnessStore.getState();
    const workspaceId = options.workspaceId ?? current.selectedWorkspaceId;
    if (!workspaceId) {
      throw new Error("No workspace selected");
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const hasPrompt = hasPromptContent(options.text, options.blocks);
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
        if (useHarnessStore.getState().sessionSlots[inFlightCreate.sessionId]) {
          activateSession(inFlightCreate.sessionId);
        }
        cancelLatencyFlow(options.latencyFlowId, "session_create_reused_inflight", {
          reusedSessionId: inFlightCreate.sessionId,
        });
        const resolvedSessionId = await inFlightCreate.promise;
        activateSession(resolvedSessionId);
        return resolvedSessionId;
      }
    }

    const branchPrefixType = useUserPreferencesStore.getState().branchPrefixType;
    const preferredModeId = useUserPreferencesStore.getState()
      .defaultSessionModeByAgentKind[options.agentKind]
      ?.trim() || undefined;
    const workspaceSurface = getWorkspaceSurface(workspaceId);
    const resolvedModeId = resolveSessionCreationModeId({
      explicitModeId: options.modeId,
      workspaceSurface,
      agentKind: options.agentKind,
      preferredModeId,
    });
    const authUser = useAuthStore.getState().user;
    const pendingSessionId = createPendingSessionId(options.agentKind);
    annotateLatencyFlow(options.latencyFlowId, {
      targetWorkspaceId: workspaceId,
      targetSessionId: pendingSessionId,
    });

    const optimisticSlot: SessionSlot = {
      ...createEmptySessionSlot(pendingSessionId, options.agentKind, {
        workspaceId,
        modelId: options.modelId,
        modeId: resolvedModeId ?? null,
        optimisticPrompt: null,
      }),
      status: "starting",
      transcriptHydrated: true,
    };

    useHarnessStore.getState().putSessionSlot(pendingSessionId, optimisticSlot);
    activateSession(pendingSessionId);
    pruneInactiveSessionStreams();

    let didStartBranchRenameTracking = false;

    const createPromise = (async () => {
      const requestOptions = buildLatencyRequestOptions(options.latencyFlowId);
      const runtimeUrl = await ensureRuntimeReadyForSessions();
      const existingSessions = await ensureWorkspaceSessions(workspaceId).catch(() => []);

      const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
      const target = await resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId);
      const client = getAnyHarnessClient({
        runtimeUrl: target.baseUrl,
        authToken: target.authToken,
      });
      const targetWorkspace = await client.workspaces.get(
        target.anyharnessWorkspaceId,
        requestOptions,
      ).catch(() => null);
      const pluginsInCodingSessionsEnabled = useUserPreferencesStore.getState()
        .pluginsInCodingSessionsEnabled;
      const subagentsEnabled = useUserPreferencesStore.getState().subagentsEnabled;
      const {
        mcpServers,
        mcpBindingSummaries,
        warnings: connectorWarnings,
      } = await resolveSessionMcpServersForLaunch({
        targetLocation: target.location,
        workspacePath: targetWorkspace?.path ?? null,
        policy: {
          workspaceSurface: "coding",
          lifecycle: "create",
          enabled: pluginsInCodingSessionsEnabled,
        },
      });
      const localWorkspace = cloudWorkspaceId ? null : targetWorkspace;
      const cloudWorkspace = cloudWorkspaceId
        ? await getCloudWorkspace(cloudWorkspaceId).catch(() => undefined)
        : undefined;

      const placeholderBranch = cloudWorkspaceId
        ? cloudWorkspace?.repo.branch?.trim() || null
        : localWorkspace?.originalBranch?.trim()
          || localWorkspace?.currentBranch?.trim()
          || null;
      const isBranchBackedWorkspace =
        cloudWorkspaceId !== null || localWorkspace?.kind === "worktree";
      const shouldInjectBranchNaming =
        existingSessions.length === 0 && isBranchBackedWorkspace && !!placeholderBranch;
      const systemPromptAppend = shouldInjectBranchNaming
        ? [
          buildFirstSessionBranchNamingPrompt({
            placeholderBranch,
            prefixType: branchPrefixType,
            user: authUser,
          }),
        ]
        : undefined;

      if (shouldInjectBranchNaming && placeholderBranch && hasPrompt) {
        beginPendingBranchRenameTracking({
          workspaceId,
          placeholderBranch,
          cloudWorkspaceId,
        });
        didStartBranchRenameTracking = true;
      }

      const session = await client.sessions.create({
        workspaceId: target.anyharnessWorkspaceId,
        agentKind: options.agentKind,
        modelId: options.modelId,
        ...(resolvedModeId ? { modeId: resolvedModeId } : {}),
        mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
        mcpBindingSummaries: mcpBindingSummaries.length > 0
          ? mcpBindingSummaries
          : undefined,
        systemPromptAppend,
        subagentsEnabled,
        origin: DESKTOP_ORIGIN,
      }, requestOptions);

      annotateLatencyFlow(options.latencyFlowId, {
        targetSessionId: session.id,
      });

      const modelRegistries = session.requestedModelId && session.modelId
        ? await client.modelRegistries.list().catch(() => [])
        : [];
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
            ...options,
            latencyFlowId: null,
            modelAvailabilityRetryCount:
              (options.modelAvailabilityRetryCount ?? 0) + 1,
            reuseInFlightEmptySession: false,
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
            ...options,
            latencyFlowId: null,
            modelAvailabilityRetryCount:
              (options.modelAvailabilityRetryCount ?? 0) + 1,
            reuseInFlightEmptySession: false,
          });
        }

        if (decision.kind === "use_current") {
          // Continue below and send the original prompt, if any, to the session
          // that already started successfully with the harness-selected model.
        }
      }

      const realSlot: SessionSlot = {
        ...createEmptySessionSlot(session.id, options.agentKind, {
          workspaceId,
          modelId: session.modelId ?? options.modelId,
          modeId: session.modeId ?? resolvedModeId ?? null,
          title: session.title ?? null,
          liveConfig: session.liveConfig ?? null,
          executionSummary: session.executionSummary ?? null,
          mcpBindingSummaries: session.mcpBindingSummaries ?? null,
          lastPromptAt: session.lastPromptAt ?? null,
          optimisticPrompt: null,
        }),
        status: resolveStatusFromExecutionSummary(session.executionSummary, session.status ?? "idle"),
        transcriptHydrated: true,
      };

      replacePendingSessionSlot(pendingSessionId, session.id, realSlot);
      updateInFlightSessionCreateId(workspaceId, pendingSessionId, session.id);
      activateSession(session.id);
      upsertWorkspaceSessionRecord(workspaceId, session);
      trackProductEvent("chat_session_created", {
        workspace_kind: cloudWorkspaceId ? "cloud" : "local",
        agent_kind: options.agentKind,
      });
      reportConnectorLaunchWarnings(connectorWarnings, showToast);

      if (options.launchIntentId) {
        useChatLaunchIntentStore.getState().markMaterializedIfActive(
          options.launchIntentId,
          {
            workspaceId,
            sessionId: session.id,
          },
        );
      }

      if (hasPrompt) {
        await promptSession({
          sessionId: session.id,
          text: options.text,
          blocks: options.blocks,
          optimisticContentParts: options.optimisticContentParts,
          workspaceId,
          latencyFlowId: options.latencyFlowId,
          promptId: options.promptId,
          onBeforeOptimisticPrompt: options.onBeforeOptimisticPrompt,
          onBeforePromptRequest: () => {
            if (options.launchIntentId) {
              useChatLaunchIntentStore.getState()
                .markSendAttemptedIfActive(options.launchIntentId);
            }
          },
        });
      } else {
        void ensureSessionStreamConnected(session.id, {
          resumeIfActive: false,
          requestHeaders: requestOptions?.headers,
        });
      }

      return session.id;
    })();

    if (!hasPrompt && shouldReuseInFlightEmptySession) {
      inFlightSessionCreatesByWorkspace.set(workspaceId, {
        sessionId: pendingSessionId,
        agentKind: options.agentKind,
        modelId: options.modelId,
        promise: createPromise,
      });
    }

    try {
      return await createPromise;
    } catch (error) {
      removeSessionSlot(pendingSessionId);
      if (previousActiveSessionId) {
        activateSession(previousActiveSessionId);
      } else {
        useHarnessStore.getState().setActiveSessionId(null);
      }
      if (didStartBranchRenameTracking) {
        useBranchRenameStore.getState().clearPendingRename(workspaceId);
      }
      throw error;
    } finally {
      const currentInFlight = inFlightSessionCreatesByWorkspace.get(workspaceId);
      if (currentInFlight?.promise === createPromise) {
        inFlightSessionCreatesByWorkspace.delete(workspaceId);
      }
    }
  }, [
    activateSession,
    closeCreatedMismatchSession,
    ensureSessionStreamConnected,
    ensureWorkspaceSessions,
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
      workspaceId: options.workspaceId,
      latencyFlowId: options.latencyFlowId,
      reuseInFlightEmptySession: options.reuseInFlightEmptySession,
    });
  }, [createSessionWithResolvedConfig]);

  return {
    createEmptySessionWithResolvedConfig,
    createSessionWithResolvedConfig,
    maybeStartFirstSessionBranchRenameTracking,
  };
}
