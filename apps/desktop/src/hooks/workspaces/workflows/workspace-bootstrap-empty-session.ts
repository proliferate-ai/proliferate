import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { useWorkspaceBootstrapCache } from "@/hooks/access/anyharness/workspaces/use-workspace-bootstrap-cache";
import type { useCloudAgentCatalogCache } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import type { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import { resolveEffectiveLaunchSelection } from "@/lib/domain/chat/models/launch-selection-defaults";
import type { ChatLaunchPreferences } from "@/lib/domain/chat/models/model-selector-types";
import { hasHiddenDismissedWorkspaceSessions } from "@/lib/domain/workspaces/selection/selection";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { getAgentLaunchOptions } from "@/lib/access/anyharness/agents";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  resolveActiveProjectedSessionForPendingWorkspace,
} from "@/hooks/workspaces/workflows/pending-workspace-projected-session";
import {
  orderBootstrapLaunchAgents,
} from "@/lib/domain/workspaces/selection/workspace-bootstrap-selection";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";

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
    getPendingWorkspaceEntry: () => PendingWorkspaceEntry | null;
    markWorkspaceBootstrappedInSession: (workspaceId: string) => void;
    setActiveSessionId: (sessionId: string | null) => void;
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
  logLatency("workspace.select.default_launch_resolved", {
    workspaceId: input.workspaceId,
    hasDefaultLaunch: !!defaultLaunch,
    agentKind: defaultLaunch?.kind ?? null,
    modelId: defaultLaunch?.modelId ?? null,
    totalElapsedMs: elapsedMs(input.startedAt),
  });

  if (defaultLaunch) {
    logLatency("workspace.select.initial_session_open.start", {
      workspaceId: input.workspaceId,
      agentKind: defaultLaunch.kind,
      modelId: defaultLaunch.modelId,
      totalElapsedMs: elapsedMs(input.startedAt),
    });
    const sessionDispatchStartedAt = startLatencyTimer();
    await deps.createEmptySessionWithResolvedConfig({
      workspaceId: input.workspaceId,
      agentKind: defaultLaunch.kind,
      modelId: defaultLaunch.modelId,
      latencyFlowId: input.latencyFlowId,
      reuseInFlightEmptySession: true,
    });
    recordMeasurementWorkflowStep({
      operationId: input.measurementOperationId,
      step: "workspace.bootstrap.initial_session",
      startedAt: sessionDispatchStartedAt,
    });
    logLatency("workspace.select.initial_session_open.dispatched", {
      workspaceId: input.workspaceId,
      agentKind: defaultLaunch.kind,
      modelId: defaultLaunch.modelId,
      dispatchElapsedMs: elapsedMs(sessionDispatchStartedAt),
      totalElapsedMs: elapsedMs(input.startedAt),
    });
    logLatency("workspace.select.initial_session_open.success", {
      workspaceId: input.workspaceId,
      agentKind: defaultLaunch.kind,
      modelId: defaultLaunch.modelId,
      totalElapsedMs: elapsedMs(input.startedAt),
    });
  }

  return { shouldReturn: false };
}
