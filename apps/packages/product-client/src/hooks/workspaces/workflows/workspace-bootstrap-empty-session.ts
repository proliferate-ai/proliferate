import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { useWorkspaceBootstrapCache } from "#product/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
import type { useCloudAgentCatalogCache } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import type { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import { resolveEffectiveLaunchSelection } from "#product/lib/domain/chat/models/launch-selection-defaults";
import type { ChatLaunchPreferences } from "#product/lib/domain/chat/models/model-selector-types";
import { hasHiddenDismissedWorkspaceSessions } from "#product/lib/domain/workspaces/selection/selection";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
} from "#product/lib/domain/agents/cloud-launch-catalog";
import { resolveUnattendedModeId } from "#product/lib/domain/agents/unattended-mode";
import { getAgentLaunchOptions } from "#product/lib/access/anyharness/agents";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import {
  recordMeasurementWorkflowStep,
} from "#product/lib/infra/measurement/measurement-port";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import {
  resolveActiveProjectedSessionForPendingWorkspace,
} from "#product/hooks/workspaces/workflows/pending-workspace-projected-session";
import {
  orderBootstrapLaunchAgents,
} from "#product/lib/domain/workspaces/selection/workspace-bootstrap-selection";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import { enterWorkspaceSessionRecovery } from "#product/hooks/workspaces/workflows/workspace-session-recovery-state";
import type { SessionRuntimeRecord } from "#product/stores/sessions/session-types";
import {
  ensureWorkspaceSetupSessionSurface,
} from "#product/hooks/workspaces/workflows/workspace-setup-session-state";
import {
  isWorkspaceSetupSessionId,
} from "#product/lib/domain/workspaces/selection/setup-session";

export async function handleEmptyWorkspaceBootstrap(
  input: {
    agentsByKind: Parameters<typeof orderBootstrapLaunchAgents>[1];
    latencyFlowId?: string | null;
    logicalWorkspaceId: string;
    measurementOperationId: MeasurementOperationId | null;
    preferences: ChatLaunchPreferences;
    requestOptions: Parameters<ReturnType<typeof useWorkspaceBootstrapCache>["fetchWorkspaceSessions"]>[0]["requestOptions"];
    sessions: WorkspaceSession[];
    shouldClearLastViewedSession: boolean;
    startedAt: number;
    timeoutMs: number;
    workspaceConnection: AnyHarnessResolvedConnection;
    workspaceId: string;
    isCurrent: () => boolean;
  },
  deps: {
    clearLastViewedSession: (workspaceId: string) => void;
    createEmptySessionWithResolvedConfig: ReturnType<
      typeof useSessionCreationActions
    >["createEmptySessionWithResolvedConfig"];
    ensureCloudAgentCatalog: ReturnType<
      typeof useCloudAgentCatalogCache
    >["ensureCloudAgentCatalog"];
    fetchWorkspaceSessions: ReturnType<typeof useWorkspaceBootstrapCache>["fetchWorkspaceSessions"];
    getActiveSessionId: () => string | null;
    getPendingWorkspaceEntry: () => PendingWorkspaceEntry | null;
    getSessionRecord: (sessionId: string) => SessionRuntimeRecord | null;
    markWorkspaceBootstrappedInSession: (workspaceId: string) => void;
  },
): Promise<{ shouldReturn: boolean }> {
  if (input.shouldClearLastViewedSession) {
    deps.clearLastViewedSession(input.logicalWorkspaceId);
  }
  const dismissedCheckStartedAt = startLatencyTimer();
  const sessionsIncludingDismissed = await deps.fetchWorkspaceSessions({
    workspaceConnection: input.workspaceConnection,
    workspaceId: input.workspaceId,
    includeDismissed: true,
    requestOptions: input.requestOptions,
    timeoutMs: input.timeoutMs,
  }).catch(() => input.sessions);
  const hasDismissedSessions = hasHiddenDismissedWorkspaceSessions(
    input.sessions,
    sessionsIncludingDismissed,
  );
  logLatency("workspace.select.dismissed_sessions_checked", {
    workspaceId: input.workspaceId,
    visibleSessionCount: input.sessions.length,
    totalSessionCount: sessionsIncludingDismissed.length,
    hasDismissedSessions,
    elapsedMs: elapsedMs(dismissedCheckStartedAt),
    totalElapsedMs: elapsedMs(input.startedAt),
  });
  recordMeasurementWorkflowStep({
    operationId: input.measurementOperationId,
    step: "workspace.bootstrap.dismissed_sessions",
    startedAt: dismissedCheckStartedAt,
    count: sessionsIncludingDismissed.length,
  });

  // Dismissed-only workspaces have no visible session to land on, so fall through to
  // the default-session creation path below (same as a truly empty workspace) instead
  // of leaving the user on the empty hero. hasDismissedSessions stays logged above.
  const activeProjectedSessionId = resolveActiveProjectedSessionForPendingWorkspace(
    input.workspaceId,
    deps.getPendingWorkspaceEntry(),
  );
  if (activeProjectedSessionId) {
    logLatency("workspace.select.initial_session_open.skipped", {
      workspaceId: input.workspaceId,
      sessionId: activeProjectedSessionId,
      reason: "projected_pending_session",
      totalElapsedMs: elapsedMs(input.startedAt),
    });
    if (input.isCurrent()) {
      deps.markWorkspaceBootstrappedInSession(input.workspaceId);
    }
    return { shouldReturn: true };
  }

  const launchCatalogStartedAt = startLatencyTimer();
  const launchCatalog = await deps.ensureCloudAgentCatalog().catch(() => null);

  logLatency("workspace.select.launch_catalog_loaded", {
    workspaceId: input.workspaceId,
    agentCount: launchCatalog?.agents?.length ?? 0,
    elapsedMs: elapsedMs(launchCatalogStartedAt),
  });
  recordMeasurementWorkflowStep({
    operationId: input.measurementOperationId,
    step: "workspace.bootstrap.launch_catalog",
    startedAt: launchCatalogStartedAt,
    count: launchCatalog?.agents?.length ?? 0,
  });

  if (!input.isCurrent()) {
    return { shouldReturn: true };
  }

  const runtimeLaunchOptionsStartedAt = startLatencyTimer();
  const runtimeLaunchOptions = await getAgentLaunchOptions(
    input.workspaceConnection,
    input.workspaceConnection.anyharnessWorkspaceId,
  ).catch(() => null);

  logLatency("workspace.select.runtime_launch_options_loaded", {
    workspaceId: input.workspaceId,
    agentCount: runtimeLaunchOptions?.agents?.length ?? 0,
    elapsedMs: elapsedMs(runtimeLaunchOptionsStartedAt),
  });

  if (!input.isCurrent()) {
    return { shouldReturn: true };
  }

  const launchAgents = orderBootstrapLaunchAgents(
    mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      launchCatalog?.agents ?? [],
      runtimeLaunchOptions?.agents ?? null,
    ),
    input.agentsByKind,
  );
  const defaultLaunch = resolveEffectiveLaunchSelection(
    launchAgents,
    input.preferences,
  );
  const activeSessionId = deps.getActiveSessionId();
  const activeSession = activeSessionId
    ? deps.getSessionRecord(activeSessionId)
    : null;
  const reusableProjectedSession = activeSession
    && activeSession.workspaceId === input.workspaceId
    && !activeSession.materializedSessionId
      ? activeSession
      : null;
  const projectedModelId = reusableProjectedSession?.requestedModelId
    ?? reusableProjectedSession?.modelId
    ?? null;
  const projectedLaunch = reusableProjectedSession?.agentKind && projectedModelId
    ? {
      kind: reusableProjectedSession.agentKind,
      modelId: projectedModelId,
    }
    : null;
  const launchSelection = projectedLaunch ?? defaultLaunch;
  logLatency("workspace.select.default_launch_resolved", {
    workspaceId: input.workspaceId,
    hasDefaultLaunch: !!launchSelection,
    reusedProjectedSessionId: reusableProjectedSession?.sessionId ?? null,
    agentKind: launchSelection?.kind ?? null,
    modelId: launchSelection?.modelId ?? null,
    totalElapsedMs: elapsedMs(input.startedAt),
  });

  if (launchSelection) {
    logLatency("workspace.select.initial_session_open.start", {
      workspaceId: input.workspaceId,
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
      reusedProjectedSessionId: reusableProjectedSession?.sessionId ?? null,
      totalElapsedMs: elapsedMs(input.startedAt),
    });
    const sessionDispatchStartedAt = startLatencyTimer();
    await deps.createEmptySessionWithResolvedConfig({
      workspaceId: input.workspaceId,
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
      clientSessionId: reusableProjectedSession?.sessionId ?? null,
      resolvedModeId: reusableProjectedSession?.modeId ?? undefined,
      unattendedModeId: resolveUnattendedModeId({
        agent: launchAgents.find((candidate) => candidate.kind === launchSelection.kind),
        modelId: launchSelection.modelId,
      }),
      latencyFlowId: input.latencyFlowId,
      preserveProjectedSessionOnCreateFailure: true,
      reuseInFlightEmptySession: true,
    });
    recordMeasurementWorkflowStep({
      operationId: input.measurementOperationId,
      step: "workspace.bootstrap.initial_session",
      startedAt: sessionDispatchStartedAt,
    });
    logLatency("workspace.select.initial_session_open.dispatched", {
      workspaceId: input.workspaceId,
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
      reusedProjectedSessionId: reusableProjectedSession?.sessionId ?? null,
      dispatchElapsedMs: elapsedMs(sessionDispatchStartedAt),
      totalElapsedMs: elapsedMs(input.startedAt),
    });
    logLatency("workspace.select.initial_session_open.success", {
      workspaceId: input.workspaceId,
      agentKind: launchSelection.kind,
      modelId: launchSelection.modelId,
      reusedProjectedSessionId: reusableProjectedSession?.sessionId ?? null,
      totalElapsedMs: elapsedMs(input.startedAt),
    });
  }

  return { shouldReturn: false };
}

export async function handleEmptyWorkspaceBootstrapWithRecovery(
  input: Parameters<typeof handleEmptyWorkspaceBootstrap>[0],
  deps: Parameters<typeof handleEmptyWorkspaceBootstrap>[1],
): Promise<{ shouldReturn: boolean; enteredRecovery: boolean }> {
  let result: { shouldReturn: boolean };
  try {
    result = await handleEmptyWorkspaceBootstrap(input, deps);
  } catch {
    const recoverySessionId = deps.getActiveSessionId()
      ?? ensureWorkspaceSetupSessionSurface(
        input.workspaceId,
        input.logicalWorkspaceId,
      );
    const enteredRecovery = input.isCurrent()
      ? enterWorkspaceSessionRecovery(
        input.workspaceId,
        input.logicalWorkspaceId,
        "session-create-failed",
        recoverySessionId,
      )
      : false;
    return { shouldReturn: true, enteredRecovery };
  }

  if (result.shouldReturn || !input.isCurrent()) {
    return { shouldReturn: result.shouldReturn, enteredRecovery: false };
  }

  const activeSessionId = deps.getActiveSessionId();
  const activeSession = activeSessionId
    ? deps.getSessionRecord(activeSessionId)
    : null;
  if (activeSession?.materializedSessionId) {
    return { shouldReturn: false, enteredRecovery: false };
  }

  const recoverySessionId = activeSessionId
    ?? ensureWorkspaceSetupSessionSurface(
      input.workspaceId,
      input.logicalWorkspaceId,
    );
  const enteredRecovery = enterWorkspaceSessionRecovery(
    input.workspaceId,
    input.logicalWorkspaceId,
    isWorkspaceSetupSessionId(recoverySessionId)
      ? "launch-configuration-unavailable"
      : "no-visible-session",
    recoverySessionId,
  );
  return { shouldReturn: true, enteredRecovery };
}
