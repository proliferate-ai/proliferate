import {
  streamSession,
} from "@anyharness/sdk";
import type {
  Session,
  SessionEventEnvelope,
  SessionStreamHandle,
} from "@anyharness/sdk";
import { recordMeasurementWorkflowStep } from "#product/lib/infra/measurement/measurement-port";
import { getMeasurementRequestOptions } from "#product/lib/infra/measurement/measurement-port";
import type {
  MeasurementOperationId,
  MeasurementWorkflowStep,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { waitForSessionHistoryTimeout } from "#product/lib/infra/abort/session-history-timeout";
import {
  resolveRuntimeTargetForWorkspace,
  type RuntimeTarget,
} from "#product/lib/access/anyharness/runtime-target";
import type { CloudSandboxGatewayUrlSource } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import {
  getSession,
  getSessionSubagents,
  listSessionEvents,
  listWorkspaceSessions,
  resumeSession as resumeRuntimeSession,
  type AnyHarnessWorkspaceSessionConnection,
  type ListSessionsOptions,
} from "#product/lib/access/anyharness/sessions";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  getMaterializedSessionId,
  isPendingSessionId,
  requireMaterializedSessionId,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

interface SessionStreamCallbacks {
  onHandle?: (handle: SessionStreamHandle) => void;
  onOpen: () => void;
  onEvent: (envelope: SessionEventEnvelope) => void;
  // Widened from `() => void` so the transport failure reaches the product-client
  // call site, which classifies it for diagnostics (never logging the message).
  onError: (error?: unknown) => void;
  onClose: () => void;
  measurementOperationId?: MeasurementOperationId | null;
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

export function getWorkspaceClientAndId(
  runtimeUrl: string,
  workspaceId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<{ connection: AnyHarnessWorkspaceSessionConnection; target: RuntimeTarget }> {
  return resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId, cloudClient).then((target) => ({
    connection: buildConnection(target),
    target,
  }));
}

export async function fetchWorkspaceSessionSummaries(
  runtimeUrl: string,
  workspaceId: string,
  options: ListSessionsOptions | undefined,
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<Session[]> {
  const { connection } = await getWorkspaceClientAndId(runtimeUrl, workspaceId, cloudClient);
  return listWorkspaceSessions(connection, options);
}

export async function getSessionClientAndWorkspace(
  sessionId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
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
    cloudClient,
  );
  return {
    connection,
    target,
    workspaceId,
    // A directory entry only exists for sessions touched this app run. Ids
    // without one (e.g. closed sessions listed from the runtime) are already
    // materialized runtime ids; only genuinely pending ids must keep failing.
    materializedSessionId: isPendingSessionId(sessionId)
      ? requireMaterializedSessionId(sessionId)
      : getMaterializedSessionId(sessionId) ?? sessionId,
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
    cloudClient: CloudSandboxGatewayUrlSource | null;
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
        getSessionClientAndWorkspace(sessionId, options?.cloudClient ?? null),
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

export async function fetchSessionSubagentRoster(
  sessionId: string,
  options?: {
    requestHeaders?: HeadersInit;
    cloudClient: CloudSandboxGatewayUrlSource | null;
  },
) {
  const { connection, materializedSessionId } = await getSessionClientAndWorkspace(
    sessionId,
    options?.cloudClient ?? null,
  );
  return getSessionSubagents(
    connection,
    materializedSessionId,
    options?.requestHeaders ? { headers: options.requestHeaders } : undefined,
  );
}

export async function fetchSessionWorkspaceSummaries(
  sessionId: string,
  options?: {
    cloudClient: CloudSandboxGatewayUrlSource | null;
  },
) {
  const { connection } = await getSessionClientAndWorkspace(
    sessionId,
    options?.cloudClient ?? null,
  );
  return listWorkspaceSessions(connection, undefined);
}

export async function fetchSessionSummary(
  sessionId: string,
  options?: {
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
    cloudClient: CloudSandboxGatewayUrlSource | null;
  },
) {
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    options?.measurementOperationId,
    "session.summary.resolve_target",
    () => getSessionClientAndWorkspace(sessionId, options?.cloudClient ?? null),
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
    cloudClient: CloudSandboxGatewayUrlSource | null;
  },
) {
  const measurementOperationId = options?.measurementOperationId;
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    measurementOperationId,
    "session.resume.resolve_target",
    () => getSessionClientAndWorkspace(sessionId, options?.cloudClient ?? null),
  );
  const requestOptions = getMeasurementRequestOptions({
    operationId: measurementOperationId,
    category: "session.resume",
    headers: options?.requestHeaders,
  });
  return resumeRuntimeSession(
    connection,
    materializedSessionId,
    undefined,
    requestOptions,
  );
}

export async function openSessionStream(
  sessionId: string,
  options: {
    afterSeq?: number;
    requestHeaders?: HeadersInit;
    cloudClient: CloudSandboxGatewayUrlSource | null;
  } & SessionStreamCallbacks,
): Promise<SessionStreamHandle> {
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    options.measurementOperationId,
    "session.stream.resolve_target",
    () => getSessionClientAndWorkspace(sessionId, options.cloudClient ?? null),
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
