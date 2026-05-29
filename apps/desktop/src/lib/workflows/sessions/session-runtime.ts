import {
  streamSession,
} from "@anyharness/sdk";
import type {
  Session,
  SessionEventEnvelope,
  SessionStreamHandle,
} from "@anyharness/sdk";
import {
  resolveSessionViewState,
} from "@proliferate/product-domain/sessions/activity";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { recordMeasurementWorkflowStep } from "@/lib/infra/measurement/debug-measurement";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";
import type {
  MeasurementOperationId,
  MeasurementWorkflowStep,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import { waitForSessionHistoryTimeout } from "@/lib/infra/abort/session-history-timeout";
import {
  resolveRuntimeTargetForWorkspace,
  type RuntimeTarget,
} from "@/lib/access/anyharness/runtime-target";
import {
  getSession,
  listSessionEvents,
  listWorkspaceSessions,
  resumeSession as resumeRuntimeSession,
  type AnyHarnessWorkspaceSessionConnection,
  type ListSessionsOptions,
} from "@/lib/access/anyharness/sessions";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  requireMaterializedSessionId,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import {
  type ManagedSessionStreamHandle,
} from "@/lib/access/anyharness/session-stream-handles";

interface SessionStreamCallbacks {
  onHandle?: (handle: SessionStreamHandle) => void;
  onOpen: () => void;
  onEvent: (envelope: SessionEventEnvelope) => void;
  onError: () => void;
  onClose: () => void;
  measurementOperationId?: MeasurementOperationId | null;
}

export type FlushAwareSessionStreamHandle = ManagedSessionStreamHandle;

export interface SessionStreamStatusDeps {
  getSessionStreamHandle(sessionId: string): FlushAwareSessionStreamHandle | null;
  isPendingSessionId(sessionId: string): boolean;
}

export interface SessionStreamDetachDeps {
  getMaterializedSessionId(clientSessionId: string): string | null;
  getSessionStreamHandle(sessionId: string): FlushAwareSessionStreamHandle | null;
  closeSessionStreamHandle(sessionId: string, handle: FlushAwareSessionStreamHandle): void;
  findClientSessionIdByMaterializedSessionId(materializedSessionId: string): string | null;
  patchSessionStreamConnectionState(
    clientSessionId: string,
    streamConnectionState: SessionRuntimeRecord["streamConnectionState"],
  ): void;
}

export interface SessionStreamPruningDeps
  extends SessionStreamDetachDeps,
    SessionStreamStatusDeps {
  getSessionRecords(): Record<string, SessionRuntimeRecord>;
  flushAllSessionStreamHandles(): void;
}

const SESSION_HISTORY_FETCH_TIMEOUT_MS = 10_000;
function buildConnection(target: RuntimeTarget): AnyHarnessWorkspaceSessionConnection {
  return {
    runtimeUrl: target.baseUrl,
    authToken: target.authToken,
    anyharnessWorkspaceId: target.anyharnessWorkspaceId,
  };
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

export function getWorkspaceClientAndId(
  runtimeUrl: string,
  workspaceId: string,
): Promise<{ connection: AnyHarnessWorkspaceSessionConnection; target: RuntimeTarget }> {
  return resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId).then((target) => ({
    connection: buildConnection(target),
    target,
  }));
}

export function assertDirectSessionCreateRuntimeConfigStamped(
  target: RuntimeTarget,
): void {
  if (target.location === "local") {
    return;
  }
  throw new Error(
    "Remote session creation requires runtime config stamping. Start this session from the cloud command path.",
  );
}

export async function fetchWorkspaceSessionSummaries(
  runtimeUrl: string,
  workspaceId: string,
  options?: ListSessionsOptions,
): Promise<Session[]> {
  const { connection } = await getWorkspaceClientAndId(runtimeUrl, workspaceId);
  return listWorkspaceSessions(connection, options);
}

export async function getSessionClientAndWorkspace(
  sessionId: string,
): Promise<{
  connection: AnyHarnessWorkspaceSessionConnection;
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

    const eventsPromise = listSessionEvents(
      connection,
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
  return getSession(
    connection,
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
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
  },
) {
  const measurementOperationId = options?.measurementOperationId;
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    measurementOperationId,
    "session.resume.resolve_target",
    () => getSessionClientAndWorkspace(sessionId),
  );
  return resumeRuntimeSession(
    connection,
    materializedSessionId,
    undefined,
    getMeasurementRequestOptions({
      operationId: measurementOperationId,
      category: "session.resume",
      headers: options?.requestHeaders,
    }),
  );
}

export function collectInactiveSessionStreamIds(
  sessions: Record<string, SessionRuntimeRecord>,
  deps: SessionStreamStatusDeps,
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  const preservedSessionIds = new Set(options?.preserveSessionIds ?? []);
  const prunableSessionIds: string[] = [];

  for (const [sessionId, record] of Object.entries(sessions)) {
    if (
      !record.materializedSessionId
      || !deps.getSessionStreamHandle(record.materializedSessionId)
      || deps.isPendingSessionId(sessionId)
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
  deps: SessionStreamDetachDeps,
): number {
  const uniqueSessionIds = Array.from(new Set(sessionIds));
  if (uniqueSessionIds.length === 0) {
    return 0;
  }

  const streams: { sessionId: string; handle: FlushAwareSessionStreamHandle }[] = [];
  for (const sessionId of uniqueSessionIds) {
    const materializedSessionId = deps.getMaterializedSessionId(sessionId);
    const handle = materializedSessionId
      ? deps.getSessionStreamHandle(materializedSessionId)
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
    deps.closeSessionStreamHandle(sessionId, handle);
    const clientSessionId = deps.findClientSessionIdByMaterializedSessionId(sessionId)
      ?? sessionId;
    deps.patchSessionStreamConnectionState(clientSessionId, "disconnected");
  }
  return streams.length;
}

export function pruneInactiveSessionStreams(
  deps: SessionStreamPruningDeps,
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  deps.flushAllSessionStreamHandles();
  const prunableSessionIds = collectInactiveSessionStreamIds(
    deps.getSessionRecords(),
    deps,
    options,
  );
  if (prunableSessionIds.length === 0) {
    return [];
  }

  detachAndCloseSessionStreams(prunableSessionIds, deps);
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
