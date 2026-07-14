import {
  streamSession,
} from "@anyharness/sdk";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import type {
  Session,
  SessionEventEnvelope,
  SessionStreamHandle,
} from "@anyharness/sdk";
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

interface SessionStreamCallbacks {
  onHandle?: (handle: SessionStreamHandle) => void;
  onOpen: () => void;
  onEvent: (envelope: SessionEventEnvelope) => void;
  onError: () => void;
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
  ssh: DesktopSshBridge | null = null,
): Promise<{ connection: AnyHarnessWorkspaceSessionConnection; target: RuntimeTarget }> {
  return resolveRuntimeTargetForWorkspace(runtimeUrl, workspaceId, ssh).then((target) => ({
    connection: buildConnection(target),
    target,
  }));
}

export async function fetchWorkspaceSessionSummaries(
  runtimeUrl: string,
  workspaceId: string,
  options?: ListSessionsOptions,
  ssh: DesktopSshBridge | null = null,
): Promise<Session[]> {
  const { connection } = await getWorkspaceClientAndId(runtimeUrl, workspaceId, ssh);
  return listWorkspaceSessions(connection, options);
}

export async function getSessionClientAndWorkspace(
  sessionId: string,
  ssh: DesktopSshBridge | null = null,
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
    ssh,
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
    ssh?: DesktopSshBridge | null;
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
        getSessionClientAndWorkspace(sessionId, options?.ssh ?? null),
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
    ssh?: DesktopSshBridge | null;
  },
) {
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    options?.measurementOperationId,
    "session.summary.resolve_target",
    () => getSessionClientAndWorkspace(sessionId, options?.ssh ?? null),
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
    ssh?: DesktopSshBridge | null;
  },
) {
  const measurementOperationId = options?.measurementOperationId;
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    measurementOperationId,
    "session.resume.resolve_target",
    () => getSessionClientAndWorkspace(sessionId, options?.ssh ?? null),
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
    ssh?: DesktopSshBridge | null;
  } & SessionStreamCallbacks,
): Promise<SessionStreamHandle> {
  const { connection, materializedSessionId } = await measureSessionWorkflowStep(
    options.measurementOperationId,
    "session.stream.resolve_target",
    () => getSessionClientAndWorkspace(sessionId, options.ssh ?? null),
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
