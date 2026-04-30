import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { useCallback } from "react";
import { createOptimisticPendingPrompt } from "@/lib/domain/chat/pending-prompts";
import { hasPromptContent } from "@/lib/domain/chat/prompt-input";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import { getCloudWorkspace } from "@/lib/integrations/cloud/workspaces";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";
import { resolveRuntimeTargetForWorkspace } from "@/lib/integrations/anyharness/runtime-target";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { buildFirstSessionBranchNamingPrompt } from "@/lib/domain/workspaces/branch-naming";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  type SessionSlot,
  useHarnessStore,
} from "@/stores/sessions/harness-store";
import { useBranchRenameStore } from "@/stores/workspaces/branch-rename-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/use-workspace-surface-lookup";
import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";
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
  getLatencyFlowRequestHeaders,
} from "@/lib/infra/latency-flow";

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
  reuseInFlightEmptySession?: boolean;
}

interface CreateEmptySessionWithResolvedConfigOptions {
  agentKind: string;
  modelId: string;
  modeId?: string;
  workspaceId?: string;
  latencyFlowId?: string | null;
  reuseInFlightEmptySession?: boolean;
}

export function resolveSessionCreationModeId(input: {
  explicitModeId?: string | null;
  workspaceSurface: string | null | undefined;
  agentKind: string;
  preferredModeId?: string | null;
}): string | undefined {
  const explicitModeId = input.explicitModeId?.trim() || undefined;
  if (explicitModeId) {
    return explicitModeId;
  }

  if (input.workspaceSurface === "cowork") {
    return resolveCoworkDefaultSessionModeId(input.agentKind);
  }

  return input.preferredModeId?.trim() || undefined;
}

function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}

function beginPendingBranchRenameTracking(input: {
  workspaceId: string;
  placeholderBranch: string;
  cloudWorkspaceId: string | null;
}): void {
  if (!input.placeholderBranch.trim()) {
    return;
  }

  const existingPending =
    useBranchRenameStore.getState().pendingByWorkspaceId[input.workspaceId] ?? null;
  if (existingPending?.placeholderBranch === input.placeholderBranch) {
    return;
  }

  useBranchRenameStore.getState().setPendingRename({
    workspaceId: input.workspaceId,
    placeholderBranch: input.placeholderBranch,
    startedAt: Date.now(),
    cloudWorkspaceId: input.cloudWorkspaceId,
  });
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

function replacePendingSessionSlot(
  pendingSessionId: string,
  nextSessionId: string,
  slot: SessionSlot,
): void {
  useHarnessStore.setState((state) => {
    const nextSlots = { ...state.sessionSlots };
    delete nextSlots[pendingSessionId];
    nextSlots[nextSessionId] = slot;

    return {
      activeSessionId:
        state.activeSessionId === pendingSessionId
          ? nextSessionId
          : state.activeSessionId,
      sessionSlots: nextSlots,
    };
  });
}

function removeSessionSlot(sessionId: string): void {
  useHarnessStore.setState((state) => {
    if (!state.sessionSlots[sessionId]) {
      return state;
    }

    const nextSlots = { ...state.sessionSlots };
    delete nextSlots[sessionId];

    return {
      sessionSlots: nextSlots,
    };
  });
}

function reportConnectorLaunchWarnings(
  warnings: ConnectorLaunchResolutionWarning[],
  showToast: (message: string, type?: "error" | "info") => void,
) {
  if (warnings.length === 0) {
    return;
  }

  for (const warning of warnings) {
    trackProductEvent("connector_skipped_at_launch", {
      connector_id: warning.catalogEntryId,
      reason_kind: warning.kind,
    });
  }

  if (warnings.length === 1) {
    const warning = warnings[0]!;
    if (warning.kind === "unsupported_target") {
      showToast(`${warning.connectorName} wasn't available in this session because it only supports local runtimes.`, "info");
      return;
    }
    if (warning.kind === "missing_stdio_command") {
      showToast(`${warning.connectorName} wasn't available in this session because its local command wasn't installed.`, "info");
      return;
    }
    if (warning.kind === "workspace_path_unresolved") {
      showToast(`${warning.connectorName} wasn't available in this session because the workspace path couldn't be resolved.`, "info");
      return;
    }
    if (warning.kind === "needs_reconnect") {
      showToast(`${warning.connectorName} wasn't available in this session because it needs reconnecting.`, "info");
      return;
    }
    showToast(`${warning.connectorName} wasn't available in this session because it needs a token.`, "info");
    return;
  }

  showToast(`${warnings.length} connectors weren't available in this session.`, "info");
}

export function useSessionCreationActions({
  ensureWorkspaceSessions,
}: SessionCreationDeps) {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const { promptSession } = useSessionPromptWorkflow();
  const { activateSession, ensureSessionStreamConnected } = useSessionRuntimeActions();
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

  const createSessionWithResolvedConfig = useCallback(async (
    options: CreateSessionWithResolvedConfigOptions,
  ): Promise<string> => {
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
        activateSession(inFlightCreate.sessionId);
        cancelLatencyFlow(options.latencyFlowId, "session_create_reused_inflight", {
          reusedSessionId: inFlightCreate.sessionId,
        });
        return inFlightCreate.promise;
      }
    }

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
    const powersInCodingSessionsEnabled = useUserPreferencesStore.getState()
      .powersInCodingSessionsEnabled;
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
        enabled: powersInCodingSessionsEnabled,
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
    const systemPromptAppend = shouldInjectBranchNaming
      ? [
        buildFirstSessionBranchNamingPrompt({
          placeholderBranch,
          prefixType: branchPrefixType,
          user: authUser,
        }),
      ]
      : undefined;
    const pendingSessionId = createPendingSessionId(options.agentKind);
    const optimisticPendingPrompt = hasPrompt
      ? createOptimisticPendingPrompt(
        options.text,
        null,
        undefined,
        options.optimisticContentParts,
      )
      : null;
    annotateLatencyFlow(options.latencyFlowId, {
      targetWorkspaceId: workspaceId,
      targetSessionId: pendingSessionId,
    });

    const optimisticSlot: SessionSlot = {
      ...createEmptySessionSlot(pendingSessionId, options.agentKind, {
        workspaceId,
        modelId: options.modelId,
        modeId: resolvedModeId ?? null,
        optimisticPrompt: optimisticPendingPrompt,
      }),
      status: "starting",
      transcriptHydrated: true,
    };

    useHarnessStore.getState().putSessionSlot(pendingSessionId, optimisticSlot);
    activateSession(pendingSessionId);
    pruneInactiveSessionStreams();

    if (shouldInjectBranchNaming && placeholderBranch && hasPrompt) {
      beginPendingBranchRenameTracking({
        workspaceId,
        placeholderBranch,
        cloudWorkspaceId,
      });
    }

    try {
      const createPromise = (async () => {
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
        }, requestOptions);

        annotateLatencyFlow(options.latencyFlowId, {
          targetSessionId: session.id,
        });
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
            optimisticPrompt: optimisticPendingPrompt,
          }),
          status: hasPrompt
            ? "running"
            : resolveStatusFromExecutionSummary(session.executionSummary, session.status ?? "idle"),
          transcriptHydrated: true,
        };

        replacePendingSessionSlot(pendingSessionId, session.id, realSlot);
        activateSession(session.id);
        upsertWorkspaceSessionRecord(workspaceId, session);
        trackProductEvent("chat_session_created", {
          workspace_kind: cloudWorkspaceId ? "cloud" : "local",
          agent_kind: options.agentKind,
        });
        reportConnectorLaunchWarnings(connectorWarnings, showToast);

        if (hasPrompt) {
          await promptSession({
            sessionId: session.id,
            text: options.text,
            blocks: options.blocks,
            optimisticContentParts: options.optimisticContentParts,
            workspaceId,
            latencyFlowId: options.latencyFlowId,
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

      return await createPromise;
    } catch (error) {
      removeSessionSlot(pendingSessionId);
      if (previousActiveSessionId) {
        activateSession(previousActiveSessionId);
      } else {
        useHarnessStore.getState().setActiveSessionId(null);
      }
      if (shouldInjectBranchNaming) {
        useBranchRenameStore.getState().clearPendingRename(workspaceId);
      }
      throw error;
    } finally {
      const currentInFlight = inFlightSessionCreatesByWorkspace.get(workspaceId);
      if (currentInFlight?.sessionId === pendingSessionId) {
        inFlightSessionCreatesByWorkspace.delete(workspaceId);
      }
    }
  }, [
    activateSession,
    ensureSessionStreamConnected,
    ensureWorkspaceSessions,
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
