import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";
import {
  type PendingPromptEntry,
  streamSession,
} from "@anyharness/sdk";
import type {
  Session,
  SessionActionCapabilities,
  SessionEventEnvelope,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStreamHandle,
} from "@anyharness/sdk";
import {
  resolveSessionViewState,
} from "@/lib/domain/sessions/activity";
import { logLatency } from "@/lib/infra/debug-latency";
import {
  getMeasurementRequestOptions,
  recordMeasurementWorkflowStep,
  type MeasurementOperationId,
  type MeasurementWorkflowStep,
} from "@/lib/infra/debug-measurement";
import { waitForSessionHistoryTimeout } from "@/lib/integrations/anyharness/session-history-timeout";
import {
  resolveRuntimeTargetForWorkspace,
  type RuntimeTarget,
} from "@/lib/integrations/anyharness/runtime-target";
import { resolveSessionMcpServersForLaunch } from "@/lib/integrations/anyharness/mcp_launch";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  createSessionRecordFromSummary,
  getMaterializedSessionId,
  getSessionRecords,
  isSessionMaterialized,
  requireMaterializedSessionId,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRelationship, SessionRuntimeRecord } from "@/stores/sessions/session-types";
import {
  closeSessionStreamHandle,
  flushAllSessionStreamHandles,
  getSessionStreamHandle,
  type ManagedSessionStreamHandle,
} from "@/lib/integrations/anyharness/session-stream-handles";

interface SessionStreamCallbacks {
  onHandle?: (handle: SessionStreamHandle) => void;
  onOpen: () => void;
  onEvent: (envelope: SessionEventEnvelope) => void;
  onError: () => void;
  onClose: () => void;
  measurementOperationId?: MeasurementOperationId | null;
}

export type FlushAwareSessionStreamHandle = ManagedSessionStreamHandle;

const SESSION_HISTORY_FETCH_TIMEOUT_MS = 10_000;
function buildConnection(baseUrl: string, authToken?: string): AnyHarnessClientConnection {
  return { runtimeUrl: baseUrl, authToken };
}

async function measureSessionWorkflowStep<T>(
  operationId: MeasurementOperationId | null | undefined,
  step: MeasurementWorkflowStep,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await fn();
    recordMeasurementWorkflowStep({
      operationId,
      step,
      startedAt,
      outcome: "completed",
    });
    return result;
  } catch (error) {
    recordMeasurementWorkflowStep({
      operationId,
      step,
      startedAt,
      outcome: "error_sanitized",
    });
    throw error;
  }
}

export function createPendingSessionId(agentKind: string): string {
  return `client-session:${agentKind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function isPendingSessionId(sessionId: string): boolean {
  if (sessionId.startsWith("pending-session:") || sessionId.startsWith("client-session:")) {
    return !isSessionMaterialized(sessionId);
  }
  const entry = useSessionDirectoryStore.getState().entriesById[sessionId];
  return !!entry && !entry.materializedSessionId;
}

export function createEmptySessionRuntimeRecord(
  sessionId: string,
  agentKind: string,
  config?: {
    workspaceId?: string | null;
    modelId?: string | null;
    modeId?: string | null;
    title?: string | null;
    actionCapabilities?: SessionActionCapabilities | null;
    liveConfig?: SessionLiveConfigSnapshot | null;
    executionSummary?: SessionExecutionSummary | null;
    mcpBindingSummaries?: SessionMcpBindingSummary[] | null;
    lastPromptAt?: string | null;
    optimisticPrompt?: PendingPromptEntry | null;
    sessionRelationship?: SessionRelationship;
  },
): SessionRuntimeRecord {
  return createEmptySessionRecord(sessionId, agentKind, config);
}

export function createSessionRuntimeRecordFromSummary(
  session: Session,
  workspaceId: string,
  options?: {
    titleFallback?: string | null;
    transcriptHydrated?: boolean;
    sessionRelationship?: SessionRelationship;
  },
): SessionRuntimeRecord {
  return createSessionRecordFromSummary(session, workspaceId, options);
}

export function getWorkspaceClientAndId(
  runtimeUrl: string,
  workspaceId: string,
): Promise<{ connection: AnyHarnessClientConnection; target: RuntimeTarget }> {
  return resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId).then((target) => ({
    connection: buildConnection(target.baseUrl, target.authToken),
    target,
  }));
}

export async function getSessionClientAndWorkspace(
  sessionId: string,
): Promise<{
  connection: AnyHarnessClientConnection;
  target: RuntimeTarget;
  workspaceId: string;
  materializedSessionId: string;
}> {
  const workspaceId =
    useSessionDirectoryStore.getState().entriesById[sessionId]?.workspaceId
    ?? useSessionSelectionStore.getState().selectedWorkspaceId;
  if (!workspaceId) {
    throw new Error("No workspace selected");
  }

  const { connection, target } = await getWorkspaceClientAndId(
    useHarnessConnectionStore.getState().runtimeUrl,
    workspaceId,
  );
  return {
    connection,
    target,
    workspaceId,
    materializedSessionId: requireMaterializedSessionId(sessionId),
  };
}

export async function fetchSessionHistory(
  sessionId: string,
  options?: {
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
    turnLimit?: number;
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
    timeoutMs?: number;
  },
) {
  const timeoutMs = options?.timeoutMs ?? SESSION_HISTORY_FETCH_TIMEOUT_MS;
  const abortController =
    timeoutMs > 0 && typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
  const timeoutId = abortController
    ? globalThis.setTimeout(() => abortController.abort(), timeoutMs)
    : null;
  const signal = abortController?.signal ?? null;

  try {
    const { connection, materializedSessionId } = await measureSessionWorkflowStep(
      options?.measurementOperationId,
      "session.history.resolve_target",
      () => waitForSessionHistoryTimeout(
        getSessionClientAndWorkspace(sessionId),
        signal,
      ),
    );
    const client = getAnyHarnessClient(connection);
    const request = getMeasurementRequestOptions({
      operationId: options?.measurementOperationId,
      category: "session.events.list",
      headers: options?.requestHeaders,
    });
    const requestWithTimeout = signal
      ? { ...request, signal }
      : request;
    const hasHistoryOptions = options?.afterSeq != null
      || options?.beforeSeq != null
      || options?.limit != null
      || options?.turnLimit != null
      || !!requestWithTimeout;

    const eventsPromise = client.sessions.listEvents(
      materializedSessionId,
      hasHistoryOptions
        ? {
          ...(options?.afterSeq != null ? { afterSeq: options.afterSeq } : {}),
          ...(options?.beforeSeq != null ? { beforeSeq: options.beforeSeq } : {}),
          ...(options?.limit != null ? { limit: options.limit } : {}),
          ...(options?.turnLimit != null ? { turnLimit: options.turnLimit } : {}),
          ...(requestWithTimeout ? { request: requestWithTimeout } : {}),
        }
        : undefined,
    );
    return await waitForSessionHistoryTimeout(eventsPromise, signal);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export async function fetchSessionSummary(
  sessionId: string,
  options?: {
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
  },
) {
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    options?.measurementOperationId,
    "session.summary.resolve_target",
    () => getSessionClientAndWorkspace(sessionId),
  );
  return getAnyHarnessClient(connection).sessions.get(
    materializedSessionId,
    getMeasurementRequestOptions({
      operationId: options?.measurementOperationId,
      category: "session.get",
      headers: options?.requestHeaders,
    }),
  );
}

export async function resumeSession(
  sessionId: string,
  options?: {
    pluginsInCodingSessionsEnabled: boolean;
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
  },
) {
  const measurementOperationId = options?.measurementOperationId;
  const { connection, target, materializedSessionId } = await measureSessionWorkflowStep(
    measurementOperationId,
    "session.resume.resolve_target",
    () => getSessionClientAndWorkspace(sessionId),
  );
  const client = getAnyHarnessClient(connection);
  const workspace = await measureSessionWorkflowStep(
    measurementOperationId,
    "session.resume.workspace_get",
    () => client.workspaces.get(
      target.anyharnessWorkspaceId,
      getMeasurementRequestOptions({
        operationId: measurementOperationId,
        category: "workspace.get",
        headers: options?.requestHeaders,
      }),
    ),
  );
  const isCowork = workspace.surface === "cowork";
  const shouldResolveLaunchMcp = isCowork || options?.pluginsInCodingSessionsEnabled === true;
  const mcpLaunch = shouldResolveLaunchMcp
    ? await measureSessionWorkflowStep(
      measurementOperationId,
      "session.resume.resolve_mcp",
      () => resolveSessionMcpServersForLaunch({
        targetLocation: target.location,
        workspacePath: workspace.path ?? null,
        launchId: `${sessionId}:${crypto.randomUUID()}`,
        policy: {
          workspaceSurface: isCowork ? "cowork" : "coding",
          lifecycle: "resume",
          enabled: shouldResolveLaunchMcp,
        },
      }),
    )
    : {
      mcpServers: [],
      mcpBindingSummaries: [],
      releaseRuntimeReservations: async () => {},
    };
  const { mcpServers, mcpBindingSummaries } = mcpLaunch;
  const releaseRuntimeReservations = mcpLaunch.releaseRuntimeReservations ?? (async () => {});
  if (!shouldResolveLaunchMcp) {
    recordMeasurementWorkflowStep({
      operationId: measurementOperationId,
      step: "session.resume.resolve_mcp",
      startedAt: performance.now(),
      outcome: "skipped",
    });
  }
  try {
    return await client.sessions.resume(
      materializedSessionId,
      {
        mcpServers,
        mcpBindingSummaries: mcpBindingSummaries.length > 0
          ? mcpBindingSummaries
          : undefined,
      },
      getMeasurementRequestOptions({
        operationId: measurementOperationId,
        category: "session.resume",
        headers: options?.requestHeaders,
      }),
    );
  } finally {
    await releaseRuntimeReservations();
  }
}

export function collectInactiveSessionStreamIds(
  sessions: Record<string, SessionRuntimeRecord>,
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  const preservedSessionIds = new Set(options?.preserveSessionIds ?? []);
  const prunableSessionIds: string[] = [];

  for (const [sessionId, record] of Object.entries(sessions)) {
    if (
      !record.materializedSessionId
      || !getSessionStreamHandle(record.materializedSessionId)
      || isPendingSessionId(sessionId)
      || preservedSessionIds.has(sessionId)
    ) {
      continue;
    }

    const viewState = resolveSessionViewState(record);
    if (viewState === "working" || viewState === "needs_input") {
      continue;
    }

    prunableSessionIds.push(sessionId);
  }

  return prunableSessionIds;
}

export function detachAndCloseSessionStreams(
  sessionIds: Iterable<string>,
): number {
  const uniqueSessionIds = Array.from(new Set(sessionIds));
  if (uniqueSessionIds.length === 0) {
    return 0;
  }

  const streams: { sessionId: string; handle: FlushAwareSessionStreamHandle }[] = [];
  for (const sessionId of uniqueSessionIds) {
    const materializedSessionId = getMaterializedSessionId(sessionId);
    const handle = materializedSessionId
      ? getSessionStreamHandle(materializedSessionId)
      : null;
    if (!materializedSessionId || !handle) {
      continue;
    }
    streams.push({ sessionId: materializedSessionId, handle });
  }

  if (streams.length === 0) {
    return 0;
  }

  for (const { sessionId, handle } of streams) {
    closeSessionStreamHandle(sessionId, handle);
    const clientSessionId =
      useSessionDirectoryStore.getState().clientSessionIdByMaterializedSessionId[sessionId]
      ?? sessionId;
    useSessionDirectoryStore.getState().patchEntry(clientSessionId, {
      streamConnectionState: "disconnected",
    });
  }
  return streams.length;
}

export function pruneInactiveSessionStreams(
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  flushAllSessionStreamHandles();
  const prunableSessionIds = collectInactiveSessionStreamIds(
    getSessionRecords(),
    options,
  );
  if (prunableSessionIds.length === 0) {
    return [];
  }

  detachAndCloseSessionStreams(prunableSessionIds);
  logLatency("session.stream.pruned", {
    closedSessionCount: prunableSessionIds.length,
  });
  return prunableSessionIds;
}

export async function openSessionStream(
  sessionId: string,
  options: {
    afterSeq?: number;
    requestHeaders?: HeadersInit;
  } & SessionStreamCallbacks,
): Promise<SessionStreamHandle> {
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    options.measurementOperationId,
    "session.stream.resolve_target",
    () => getSessionClientAndWorkspace(sessionId),
  );

  const handle = streamSession({
    baseUrl: connection.runtimeUrl,
    authToken: connection.authToken ?? undefined,
    headers: options.requestHeaders,
    sessionId: materializedSessionId,
    afterSeq: options.afterSeq ?? 0,
    timing: options.measurementOperationId
      ? {
        category: "session.stream",
        measurementOperationId: options.measurementOperationId,
      }
      : undefined,
    onOpen: options.onOpen,
    onEvent: options.onEvent,
    onError: options.onError,
    onClose: options.onClose,
  }) as SessionStreamHandle;

  options.onHandle?.(handle);
  return handle;
}
